// API integration tests for the auth + users surface.
//
// Hits a live server (default http://localhost:3000). Mongo must be running
// in replica-set mode (docker compose up -d) and the server must be running
// (npm run dev) BEFORE invoking `node --test test/api.auth.test.js`.
//
// Each test creates fresh accounts with random suffixes so reruns don't
// collide. We don't tear down mongo state between runs — the unique-index
// + random-suffix combo keeps things isolated.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.QA_BASE_URL || 'http://localhost:3000';
const API = `${BASE}/api/v1`;

const rand = () => Math.random().toString(36).slice(2, 10);

const req = async (method, path, { body, token, expectStatus } = {}) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _raw: text };
  }
  if (expectStatus !== undefined && res.status !== expectStatus) {
    throw new Error(
      `${method} ${path} expected ${expectStatus} got ${res.status}: ${text}`,
    );
  }
  return { status: res.status, body: json };
};

const newCreds = () => {
  const suffix = rand();
  return {
    email: `qa-${suffix}@example.com`,
    username: `qa_${suffix}`,
    password: `pw-${suffix}-pw`,
  };
};

const registerAndVerify = async (creds = newCreds()) => {
  const reg = await req('POST', '/auth/register', {
    body: creds,
    expectStatus: 201,
  });
  const verify = await req('POST', '/auth/verify-otp', {
    body: { authId: reg.body.authId, otp: '1234' },
    expectStatus: 200,
  });
  return { creds, authId: reg.body.authId, token: verify.body.token, user: verify.body.user };
};

before(async () => {
  // Smoke: confirm the server is reachable. If not, fail loudly so the
  // user knows to start docker + npm run dev first instead of staring at
  // 50 cryptic ECONNREFUSED stack traces.
  try {
    const res = await fetch(`${BASE}/health`);
    if (!res.ok) {
      throw new Error(`/health returned ${res.status}`);
    }
  } catch (err) {
    throw new Error(
      `Cannot reach server at ${BASE}. Ensure mongo is up (docker compose up -d) and the dev server is running (npm run dev). Original: ${err.message}`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// /auth/register
// ─────────────────────────────────────────────────────────────────────────────

test('POST /auth/register — happy path returns 201 + authId', async () => {
  const creds = newCreds();
  const { status, body } = await req('POST', '/auth/register', { body: creds });
  assert.equal(status, 201);
  assert.ok(body.authId, 'authId in response');
  assert.match(body.authId, /^[0-9a-f]{24}$/, 'authId is a Mongo ObjectId hex');
});

test('POST /auth/register — duplicate email returns 409 (pre-check)', async () => {
  const creds = newCreds();
  await req('POST', '/auth/register', { body: creds, expectStatus: 201 });
  const { status, body } = await req('POST', '/auth/register', {
    body: { ...creds, username: `dup_${rand()}` },
  });
  assert.equal(status, 409);
  assert.match(body.error?.message || '', /already in use/i);
});

test('POST /auth/register — duplicate username returns 409', async () => {
  const creds = newCreds();
  await req('POST', '/auth/register', { body: creds, expectStatus: 201 });
  const { status, body } = await req('POST', '/auth/register', {
    body: { ...creds, email: `${rand()}@example.com` },
  });
  assert.equal(status, 409);
  assert.match(body.error?.message || '', /already in use/i);
});

test('POST /auth/register — short password (<8) returns 400', async () => {
  const { status, body } = await req('POST', '/auth/register', {
    body: { email: `${rand()}@example.com`, username: `u_${rand()}`, password: 'short' },
  });
  assert.equal(status, 400);
  assert.ok(body.error?.details, 'joi details on validation error');
});

test('POST /auth/register — invalid email shape returns 400', async () => {
  const { status } = await req('POST', '/auth/register', {
    body: { email: 'not-an-email', username: `u_${rand()}`, password: 'longenough1' },
  });
  assert.equal(status, 400);
});

test('POST /auth/register — invalid username chars returns 400', async () => {
  const { status } = await req('POST', '/auth/register', {
    body: { email: `${rand()}@example.com`, username: 'bad name!', password: 'longenough1' },
  });
  assert.equal(status, 400);
});

test('POST /auth/register — username and email are lowercased on input', async () => {
  // Register MixedCase, then attempt register with lowercase variant — should 409.
  const suffix = rand();
  const upper = {
    email: `Mixed-${suffix}@Example.COM`,
    username: `Mixed_${suffix}`,
    password: 'longenough1',
  };
  await req('POST', '/auth/register', { body: upper, expectStatus: 201 });
  const { status } = await req('POST', '/auth/register', {
    body: {
      email: `mixed-${suffix}@example.com`,
      username: `mixed_${suffix}`,
      password: 'longenough1',
    },
  });
  assert.equal(status, 409, 'case-insensitive uniqueness must be enforced');
});

// ─────────────────────────────────────────────────────────────────────────────
// /auth/verify-otp
// ─────────────────────────────────────────────────────────────────────────────

test('POST /auth/verify-otp — accepts "1234" in dummy mode and returns JWT + user', async () => {
  const creds = newCreds();
  const reg = await req('POST', '/auth/register', { body: creds, expectStatus: 201 });
  const { status, body } = await req('POST', '/auth/verify-otp', {
    body: { authId: reg.body.authId, otp: '1234' },
  });
  assert.equal(status, 200);
  assert.ok(body.token, 'token in response');
  assert.ok(body.user, 'user in response');
  assert.equal(body.user.isVerified, true);
  assert.equal(body.user.email, creds.email);
});

test('POST /auth/verify-otp — rejects non-1234 in dummy mode', async () => {
  const creds = newCreds();
  const reg = await req('POST', '/auth/register', { body: creds, expectStatus: 201 });
  const { status } = await req('POST', '/auth/verify-otp', {
    body: { authId: reg.body.authId, otp: '9999' },
  });
  assert.equal(status, 400);
});

test('POST /auth/verify-otp — already-verified returns 400', async () => {
  const { authId } = await registerAndVerify();
  const { status } = await req('POST', '/auth/verify-otp', {
    body: { authId, otp: '1234' },
  });
  assert.equal(status, 400);
});

test('POST /auth/verify-otp — invalid authId returns 400', async () => {
  const { status } = await req('POST', '/auth/verify-otp', {
    body: { authId: 'not-an-objectid', otp: '1234' },
  });
  assert.equal(status, 400);
});

test('POST /auth/resend-otp — succeeds for unverified account', async () => {
  const creds = newCreds();
  const reg = await req('POST', '/auth/register', { body: creds, expectStatus: 201 });
  const { status } = await req('POST', '/auth/resend-otp', {
    body: { authId: reg.body.authId },
  });
  assert.equal(status, 200);
});

test('POST /auth/resend-otp — already-verified returns 400', async () => {
  const { authId } = await registerAndVerify();
  const { status } = await req('POST', '/auth/resend-otp', {
    body: { authId },
  });
  assert.equal(status, 400);
});

// ─────────────────────────────────────────────────────────────────────────────
// /auth/login
// ─────────────────────────────────────────────────────────────────────────────

test('POST /auth/login — happy path with email returns 200 + token', async () => {
  const { creds } = await registerAndVerify();
  const { status, body } = await req('POST', '/auth/login', {
    body: { emailOrUsername: creds.email, password: creds.password },
  });
  assert.equal(status, 200);
  assert.ok(body.token);
});

test('POST /auth/login — happy path with username returns 200 + token', async () => {
  const { creds } = await registerAndVerify();
  const { status } = await req('POST', '/auth/login', {
    body: { emailOrUsername: creds.username, password: creds.password },
  });
  assert.equal(status, 200);
});

test('POST /auth/login — wrong password returns 401 generic', async () => {
  const { creds } = await registerAndVerify();
  const { status, body } = await req('POST', '/auth/login', {
    body: { emailOrUsername: creds.email, password: 'wrong-password-yes' },
  });
  assert.equal(status, 401);
  assert.match(body.error?.message || '', /invalid credentials/i);
});

test('POST /auth/login — unknown email returns 401 generic (no enumeration)', async () => {
  const { status, body } = await req('POST', '/auth/login', {
    body: { emailOrUsername: `nope-${rand()}@example.com`, password: 'whatever1' },
  });
  assert.equal(status, 401);
  assert.match(body.error?.message || '', /invalid credentials/i);
});

test('POST /auth/login — unverified account returns 403 with UNVERIFIED code', async () => {
  const creds = newCreds();
  await req('POST', '/auth/register', { body: creds, expectStatus: 201 });
  const { status, body } = await req('POST', '/auth/login', {
    body: { emailOrUsername: creds.email, password: creds.password },
  });
  assert.equal(status, 403);
  assert.equal(body.error?.details?.code, 'UNVERIFIED');
});

// ─────────────────────────────────────────────────────────────────────────────
// /auth/logout (no-op for plain JWT)
// ─────────────────────────────────────────────────────────────────────────────

test('POST /auth/logout — authed returns 200', async () => {
  const { token } = await registerAndVerify();
  const { status } = await req('POST', '/auth/logout', { token });
  assert.equal(status, 200);
});

test('POST /auth/logout — without token returns 401', async () => {
  const { status } = await req('POST', '/auth/logout');
  assert.equal(status, 401);
});

// ─────────────────────────────────────────────────────────────────────────────
// /auth/forgot-password + /auth/reset-password
// ─────────────────────────────────────────────────────────────────────────────

test('POST /auth/forgot-password — known email returns 200', async () => {
  const { creds } = await registerAndVerify();
  const { status } = await req('POST', '/auth/forgot-password', {
    body: { email: creds.email },
  });
  assert.equal(status, 200);
});

test('POST /auth/forgot-password — unknown email returns 200 (no enumeration)', async () => {
  const { status } = await req('POST', '/auth/forgot-password', {
    body: { email: `nope-${rand()}@example.com` },
  });
  assert.equal(status, 200);
});

test('POST /auth/reset-password — invalid token returns 400', async () => {
  const { status } = await req('POST', '/auth/reset-password', {
    body: { token: 'a'.repeat(64), newPassword: 'newpassword1' },
  });
  assert.equal(status, 400);
});

// ─────────────────────────────────────────────────────────────────────────────
// /auth/change-password (authed)
// ─────────────────────────────────────────────────────────────────────────────

test('POST /auth/change-password — happy path lets user log in with new password', async () => {
  const { creds, token } = await registerAndVerify();
  const newPassword = `new-${rand()}-pw`;
  const { status } = await req('POST', '/auth/change-password', {
    token,
    body: { currentPassword: creds.password, newPassword },
  });
  assert.equal(status, 200);
  // Login with new password works.
  await req('POST', '/auth/login', {
    body: { emailOrUsername: creds.email, password: newPassword },
    expectStatus: 200,
  });
  // Login with old password fails.
  await req('POST', '/auth/login', {
    body: { emailOrUsername: creds.email, password: creds.password },
    expectStatus: 401,
  });
});

test('POST /auth/change-password — wrong current password returns 401', async () => {
  const { token } = await registerAndVerify();
  const { status } = await req('POST', '/auth/change-password', {
    token,
    body: { currentPassword: 'wrong-pw-yes', newPassword: 'newpassword1' },
  });
  assert.equal(status, 401);
});

test('POST /auth/change-password — without token returns 401', async () => {
  const { status } = await req('POST', '/auth/change-password', {
    body: { currentPassword: 'whatever1', newPassword: 'whatever2' },
  });
  assert.equal(status, 401);
});

// ─────────────────────────────────────────────────────────────────────────────
// /users/me
// ─────────────────────────────────────────────────────────────────────────────

test('GET /users/me — returns the authed user with profile fields flat', async () => {
  const { creds, token } = await registerAndVerify();
  const { status, body } = await req('GET', '/users/me', { token });
  assert.equal(status, 200);
  assert.equal(body.email, creds.email);
  assert.equal(body.username, creds.username);
  assert.equal(body.role, 'user');
  // Profile fields live at top level (no `profile` wrapper per PRD).
  assert.ok(!('profile' in body), 'no profile wrapper');
  // Sensitive fields stripped.
  assert.ok(!('passwordHash' in body));
});

test('GET /users/me — without token returns 401', async () => {
  const { status } = await req('GET', '/users/me');
  assert.equal(status, 401);
});

test('PATCH /users/me — updates allowlisted profile fields at top level', async () => {
  const { token } = await registerAndVerify();
  const updates = {
    bio: 'hello world',
    picture: 'https://example.com/pic.jpg',
    phone: '+1-555-1234',
  };
  const { status, body } = await req('PATCH', '/users/me', { token, body: updates });
  assert.equal(status, 200);
  assert.equal(body.bio, updates.bio);
  assert.equal(body.picture, updates.picture);
  assert.equal(body.phone, updates.phone);
});

test('PATCH /users/me — rejects non-allowlisted fields with 400', async () => {
  const { token } = await registerAndVerify();
  const { status, body } = await req('PATCH', '/users/me', {
    token,
    body: { email: `new-${rand()}@example.com` },
  });
  assert.equal(status, 400);
  assert.match(body.error?.message || '', /not allowed/i);
});

test('PATCH /users/me — rejects role escalation attempt with 400', async () => {
  const { token } = await registerAndVerify();
  const { status } = await req('PATCH', '/users/me', {
    token,
    body: { role: 'admin' },
  });
  assert.equal(status, 400);
});

test('PATCH /users/me — accepts nested address subdoc', async () => {
  const { token } = await registerAndVerify();
  const { status, body } = await req('PATCH', '/users/me', {
    token,
    body: {
      address: {
        line1: '1 Test St',
        city: 'Testville',
        country: 'Testland',
      },
    },
  });
  assert.equal(status, 200);
  assert.equal(body.address?.line1, '1 Test St');
  assert.equal(body.address?.city, 'Testville');
});

test('DELETE /users/me — soft-deletes; subsequent login returns 401 generic', async () => {
  const { creds, token } = await registerAndVerify();
  const del = await req('DELETE', '/users/me', { token });
  assert.equal(del.status, 200);
  // Login should fail with 401 (NOT a leaked "deleted" message).
  const login = await req('POST', '/auth/login', {
    body: { emailOrUsername: creds.email, password: creds.password },
  });
  assert.equal(login.status, 401);
  assert.match(login.body.error?.message || '', /invalid credentials/i);
});

test('DELETE /users/me — outstanding JWT also fails on next request (401)', async () => {
  const { token } = await registerAndVerify();
  await req('DELETE', '/users/me', { token, expectStatus: 200 });
  // The token is still cryptographically valid, but requireAuth's DB load
  // sees users.deletedAt and returns 401.
  const me = await req('GET', '/users/me', { token });
  assert.equal(me.status, 401);
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin endpoints — gated by requireRole('admin')
// ─────────────────────────────────────────────────────────────────────────────

test('GET /users — non-admin returns 403', async () => {
  const { token } = await registerAndVerify();
  const { status } = await req('GET', '/users', { token });
  assert.equal(status, 403);
});

test('GET /users/:id — non-admin returns 403', async () => {
  const { token, user } = await registerAndVerify();
  const { status } = await req('GET', `/users/${user._id}`, { token });
  assert.equal(status, 403);
});

test('DELETE /users/:id — non-admin returns 403', async () => {
  const { token, user } = await registerAndVerify();
  const { status } = await req('DELETE', `/users/${user._id}`, { token });
  assert.equal(status, 403);
});

test('GET /users — without token returns 401', async () => {
  const { status } = await req('GET', '/users');
  assert.equal(status, 401);
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin endpoints — happy path requires QA_ADMIN_TOKEN env var
// ─────────────────────────────────────────────────────────────────────────────
//
// The first admin must be created by `node scripts/create-admin.js`.
// Set QA_ADMIN_TOKEN to a JWT obtained by logging in as that admin to
// exercise the admin happy path. Without it, these tests skip.

const adminToken = process.env.QA_ADMIN_TOKEN;
const adminTest = adminToken ? test : test.skip;

adminTest('GET /users — admin lists users', async () => {
  const { status, body } = await req('GET', '/users', { token: adminToken });
  assert.equal(status, 200);
  assert.ok(Array.isArray(body));
});

adminTest('GET /users/:id — admin gets a user by id', async () => {
  const { user } = await registerAndVerify();
  const { status, body } = await req('GET', `/users/${user._id}`, { token: adminToken });
  assert.equal(status, 200);
  assert.equal(body._id, user._id);
});

adminTest('DELETE /users/:id — admin soft-deletes a user', async () => {
  const { creds, user } = await registerAndVerify();
  const del = await req('DELETE', `/users/${user._id}`, { token: adminToken });
  assert.equal(del.status, 200);
  // Confirm the user can no longer log in.
  const login = await req('POST', '/auth/login', {
    body: { emailOrUsername: creds.email, password: creds.password },
  });
  assert.equal(login.status, 401);
});

adminTest('GET /users/:id — admin gets 404 for invalid id', async () => {
  const { status } = await req('GET', '/users/not-an-id', { token: adminToken });
  assert.equal(status, 404);
});
