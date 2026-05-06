# PRD — Auth Feature

> Status: under `/plan-eng-review` (pass 2). Owner: tech@tghtech.com. Date: 2026-05-06. Branch: `main`.

## Context

The e-commerce backend has clean route/controller stubs but **no implementation**: every service method throws `ApiError(501)`, no DB driver is installed, `src/models/` is empty (`.gitkeep` only), there is no auth middleware, no validation middleware, no tests. `JWT_SECRET` and `JWT_EXPIRES_IN` env vars exist in `src/config/env.js` but are unused.

This PRD specifies the auth feature so it can be reviewed and then implemented in a follow-up session.

### Decisions locked in
- **DB**: MongoDB + Mongoose
- **Tokens**: plain JWT, 7d expiry, no refresh, no revocation. JWT carries `authId` only — `role` is fetched fresh from DB on every authed request to avoid stale-role exploits.
- **Schema**: exactly two collections — `auth` and `users`. `email` and `username` are **denormalized into both**, and **immutable post-signup** (no change-email, no change-username endpoints) — drift risk is therefore zero by construction
- **Profile fields are flat on `users`** (no `profile` subdoc). `picture`, `bio`, `dateOfBirth`, `gender`, `phone`, `address` live as top-level fields on the user document. `address` itself stays as a nested subdoc since it's natural data structure (one logical address, multiple fields), not a wrapper.
- **OTP**: always `1234` when `OTP_DUMMY=true` (default). Real OTP delivery is out of scope; the production code path is built but feature-flagged off.
- **No automated tests** (per explicit user direction). Manual curl-based verification only. Risk acknowledged below.
- **Admin bootstrap**: a one-shot CLI seed script (`scripts/create-admin.js`). No env-var auto-elevation, no public admin endpoint.
- **Soft-delete**: writes `deletedAt` on BOTH `auth` and `users`. Login rejects if either flag is set.
- **Mongo transactions ALWAYS used** for any multi-collection write (register's two inserts, `setAccountStatus`'s two updates). One code path, atomic guarantees, no env-conditional branching.
- **Mongo replica-set is required everywhere** (transactions need it). Local dev uses a `docker-compose.yml` at repo root that starts a single-node replica set with `--replSet rs0` and runs `rs.initiate()` once on first start. The app refuses to boot if connected to a non-replica-set Mongo. Cost: `docker compose up` instead of `mongod`. One-time learning curve, zero ongoing friction.
- **Signup race**: keep the pre-check on `auth.email`/`auth.username` for the friendly common-case error, AND catch `E11000` (Mongo duplicate-key) from the unique index as a fallback for the racing case. Translate either to `ApiError(409, 'email or username already in use')`. The register's two inserts run inside a transaction, so a partial-write orphan auth row is impossible.

### Where this PRD lives
- Plan file: `/home/rona/.claude/plans/implement-a-prd-of-adaptive-goblet.md`
- Repo: `docs/prd-auth.md`
- **Wiki**: not written mid-session per `CLAUDE.md` and `e-commerce-wiki/APPROACH.md`. End-of-session capture ritual promotes the schema decision into `wiki/decisions/` and the signup/login flows into `wiki/flows/` — separate step run by the user.

---

## Goals

1. Users can: register, verify via OTP, log in, log out, change password, reset forgotten password, view/update their profile fields, soft-delete their account.
2. `auth` (credentials) and `users` (profile + denorm identity) are the only two collections, joined by `users.authId`.
3. JWT-protected routes work via a single `requireAuth` middleware (loads fresh user from DB), plus `requireRole('admin')` for admin endpoints.
4. Validation through joi at the boundary; errors flow through existing `ApiError` + `errorHandler`.
5. The first admin user is created via a one-shot seed script.

## Non-goals (NOT in scope)

- **Automated tests** — explicitly out per user direction. Verification is manual curl flows.
- **Email change** — email is immutable post-signup. (Mitigates the standard account-takeover-via-email-swap threat.)
- **Username change** — username is immutable post-signup. (Same denorm immutability reasoning.)
- Real OTP delivery (SMS/email). Dummy `1234` is the only path.
- OAuth / social login.
- Refresh tokens, token revocation, sign-out-all-devices.
- RBAC engine — single `role: 'user'|'admin'` field, that's it.
- Rate limiting / account lockout (flagged as risk).
- Password complexity beyond min length 8.
- 2FA at login (OTP only at signup).
- Audit log.

---

## Data model

### Two collections, fields flat on users

```
auth (collection)                       users (collection)
  _id                                     _id
  email                  ← denorm, IMMUT  authId          (FK → auth._id)
  username               ← denorm, IMMUT  email           ← denorm, IMMUT
  passwordHash                            username        ← denorm, IMMUT
  isVerified                              role            ('user'|'admin')
  otpHash                                 isVerified      ← denorm
  otpExpiresAt                            picture         (URL string)
  otpAttempts                             bio             (string, ≤500)
  passwordResetTokenHash                  dateOfBirth     (Date)
  passwordResetExpiresAt                  gender          (enum)
  deletedAt                               phone           (string)
  createdAt, updatedAt                    address         (subdoc: line1, city, state,
                                                                   postalCode, country)
                                          deletedAt
                                          createdAt, updatedAt

   ↑ source of truth for credentials       ↑ profile fields flat at top level
```

### Indexes
```
auth.email      unique
auth.username   unique
users.authId    unique
users.email     unique  (denorm — index protects against duplicate inserts)
users.username  unique  (denorm — same)
```

`deletedAt` is not indexed. Query patterns don't benefit: `login` and `requireAuth` load by email/authId and check `deletedAt` on the loaded doc (not in the query filter). The only query filtering on `deletedAt` is the admin user list, which is rare enough that a full collection scan is acceptable. If admin list grows slow, add a partial index `{ deletedAt: { $exists: false } }` later.

### Denormalization rule

`email` and `username` are written ONCE during `/auth/register` (transactional double-insert) and never mutated. There is no change-email or change-username endpoint. **Drift is impossible by construction** for those fields — no mutation path exists.

Two-collection writes happen in only two places after register:

1. **`POST /auth/verify-otp`** — sets `isVerified=true` on both `auth` and `users`.
2. **`DELETE /users/me`** — sets `deletedAt=now` on both `auth` and `users`.

Both go through a single helper `setAccountStatus(authId, { isVerified?, deletedAt? })`:

```js
async function setAccountStatus(authId, fields) {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Auth.updateOne({ _id: authId }, fields, { session });
      await User.updateOne({ authId }, fields, { session });
    });
  } finally {
    await session.endSession();
  }
}
```

`session.withTransaction` is Mongoose's retry-on-transient-error wrapper. Either both writes commit or neither does; Mongo handles the rollback automatically. No manual capture-before-write, no orphan-state risk, no `[CRITICAL]` log path.

The same pattern applies to `/auth/register`'s two inserts.

This requires Mongo to be running in **replica-set mode**, in dev and prod alike. The app refuses to boot otherwise (see `src/config/db.js`). Local dev uses the bundled `docker-compose.yml` (see file plan).

---

## Auth flows

### Signup → OTP verify → first token

```
POST /auth/register  { email, username, password }
        │
        ▼
  validate (joi)
        │
        ▼
  uniqueness PRE-CHECK on auth.email + auth.username (friendly common-case error)
        │
        ▼
  bcrypt.hash(password, BCRYPT_ROUNDS=10)
        │
        ▼
  ┌─ OTP_DUMMY=true:  skip OTP gen (verify will accept "1234")
  └─ OTP_DUMMY=false: gen 6-digit, sha256 hash, expiresAt = now+10min
        │
        ▼
  txn: insert auth + insert users (atomic; either both commit or neither)
  on E11000 duplicate-key error from EITHER insert → ApiError(409, 'email or username already in use')
  (no orphan-auth path possible — txn rolls both back if users insert fails)
        │
        ▼
  log "OTP for {email}: 1234" (dev) / send via provider stub (prod, out of scope)
        │
        ▼
  201 { authId, message }   ← NO TOKEN until verified

POST /auth/verify-otp  { authId, otp }
        │
        ▼
  load auth by authId
        │
        ▼
  if isVerified → 400 "already verified"
        │
        ▼
  ┌─ OTP_DUMMY=true:  accept iff otp === "1234"
  └─ OTP_DUMMY=false: sha256-compare, check expiresAt, otpAttempts++ (lock at 5)
        │
        ▼
  setAccountStatus(authId, { isVerified: true })   ← atomic txn: both writes or neither
  clear auth.otp* fields
        │
        ▼
  sign JWT { sub: authId }   ← role NOT in JWT (read from DB on every request)
        │
        ▼
  200 { token, user }

POST /auth/resend-otp  { authId }    ← always succeeds in dummy mode (no-op + 200)
```

### Login

```
POST /auth/login  { emailOrUsername, password }
        │
        ▼
  load auth by { $or: [{email}, {username}] }
        │
        ▼
  not found → 401 "invalid credentials"   (generic — no user enumeration)
        │
        ▼
  auth.deletedAt set → 401 "invalid credentials"   (deleted accounts cannot log in;
                                                    response identical to "not found"
                                                    so an attacker can't probe for
                                                    deleted accounts)
        │
        ▼
  !isVerified → 403 { code: 'UNVERIFIED', authId }
        │
        ▼
  bcrypt.compare → mismatch → 401 "invalid credentials"
        │
        ▼
  sign JWT { sub: authId } → 200 { token, user }
```

### Logout

Plain JWT has no server-side state. `POST /auth/logout` is a 200 no-op for symmetry. Documented as "client deletes the token; revocation deferred."

### Forgot / reset password

```
POST /auth/forgot-password  { email }
   load auth by email
   ALWAYS return 200 (no enumeration), even if not found OR auth.deletedAt set
   if found AND not deleted: gen 32-byte token, store sha256(token) + expiresAt=now+30min
   log/send token via reset link

POST /auth/reset-password  { token, newPassword }
   sha256(token) → find auth where hash matches AND expiresAt > now AND deletedAt unset
   not found → 400
   bcrypt.hash(newPassword) → save → clear reset fields → 200
```

### Change password (authed)

```
POST /auth/change-password  { currentPassword, newPassword }
   requireAuth → req.authId, req.user (loaded fresh from DB)
   bcrypt.compare(currentPassword) → mismatch → 401
   hash + save → 200
```

### Profile read/write

```
GET   /users/me                   requireAuth → user doc (already loaded by requireAuth)
PATCH /users/me                   requireAuth → updates picture, bio, dateOfBirth,
                                                gender, phone, address (allowlist).
                                                joi schema uses .unknown(false) so any
                                                other key is rejected at validation
                                                with ApiError(400).
DELETE /users/me                  requireAuth → setAccountStatus(authId, {deletedAt: now})
                                                atomic transaction over both writes.
                                                Subsequent login attempts return 401
                                                (auth check). Subsequent authed requests
                                                using existing JWT also fail with 401
                                                (requireAuth's DB load sees deletedAt).

# Admin
GET    /users                     requireAuth + requireRole('admin') → list (excludes deletedAt)
GET    /users/:id                 requireAuth + requireRole('admin')
DELETE /users/:id                 requireAuth + requireRole('admin') → soft-delete (same path)
```

---

## API surface (final)

```
PUBLIC
  POST   /api/v1/auth/register
  POST   /api/v1/auth/verify-otp
  POST   /api/v1/auth/resend-otp
  POST   /api/v1/auth/login
  POST   /api/v1/auth/forgot-password
  POST   /api/v1/auth/reset-password

AUTHED (requireAuth — loads fresh user from DB, returns 401 if user soft-deleted)
  POST   /api/v1/auth/logout
  POST   /api/v1/auth/change-password
  GET    /api/v1/users/me
  PATCH  /api/v1/users/me
  DELETE /api/v1/users/me

ADMIN (requireAuth + requireRole('admin') — checks req.user.role from fresh DB load)
  GET    /api/v1/users
  GET    /api/v1/users/:id
  DELETE /api/v1/users/:id
```

The original stubs declared `POST /users`, `PATCH /users/:id`, `DELETE /users/:id`. These are replaced by `/users/me` (self-service) and admin variants on `/users/:id`. `POST /users` is removed — user creation only happens via `/auth/register` (or `scripts/create-admin.js` for the first admin).

---

## Admin bootstrap — seed script

`scripts/create-admin.js` is a one-shot CLI run manually after deploy:

```
node scripts/create-admin.js
  → prompts for email
  → prompts for username
  → prompts for password (hidden input, confirm)
  → bcrypt.hash, generate authId
  → insert auth { ..., isVerified: true }   ← skips OTP since admin is trusted
  → insert users { authId, email, username, role: 'admin', isVerified: true }
  → prints "admin created: <email>"
  → exits 0
```

Idempotency: if the email already exists in `auth`, prompt "elevate existing user to admin?" — if yes, set `users.role='admin'`. If no, exit non-zero.

---

## Security model

| Concern              | Decision                                              |
|----------------------|-------------------------------------------------------|
| Password hashing     | bcryptjs, cost 10, env `BCRYPT_ROUNDS`                |
| JWT algorithm        | HS256, secret in `JWT_SECRET`, expires `JWT_EXPIRES_IN=7d` |
| JWT payload          | `{ sub: authId }` only — role NOT in JWT              |
| JWT_SECRET validation| App refuses to start if unset, empty, or <32 chars    |
| Role check freshness | requireAuth loads user from DB on every authed request; requireRole reads req.user.role (always fresh, no staleness) |
| OTP storage          | sha256 hash + expiresAt (real mode); not stored (dummy mode) |
| Reset token storage  | sha256 hash + expiresAt; single-use (cleared on consumption) |
| Login error message  | generic "invalid credentials" — no email enumeration; deleted-account also returns this |
| requireAuth on soft-deleted user | 401 generic "invalid credentials" (matches login flow) |
| Forgot-pw response   | always 200 — no email enumeration                     |
| OTP attempts (real)  | cap at 5, then regenerate-required                    |
| Identity changes     | none — email and username are immutable               |
| Response sanitization| Mongoose `toJSON` strips `passwordHash`, `otpHash`, all `*Token*`, `*ExpiresAt*` |
| CORS                 | existing `cors()`; PRD recommends restricting `CORS_ORIGIN` in prod |
| Helmet               | already mounted in `src/app.js`                       |

---

## Validation

joi schemas under `src/middleware/validators/` per resource. A generic `validate(schema)` factory mounts them on routes and converts joi errors into `ApiError(400, message, { details: joiError.details })`. Examples: `registerSchema`, `loginSchema`, `otpSchema`, `forgotPasswordSchema`, `resetPasswordSchema`, `changePasswordSchema`, `updateMeSchema`.

Field rules:
- `email`: valid email, lowercased, trimmed
- `username`: 3–30 chars, `[a-zA-Z0-9_]`, lowercased, trimmed (case-insensitive uniqueness via the lowercase-at-validation rule)
- `password`: ≥8 chars (no other complexity rules per non-goals)
- `bio`: ≤500 chars
- `picture`: valid URL
- `phone`: optional, basic length sanity

`updateMeSchema` uses joi's `.unknown(false)`: any key not in the allowlist (`picture`, `bio`, `dateOfBirth`, `gender`, `phone`, `address`) is rejected at validation with `ApiError(400, 'unknown field: <name>')`.

---

## Dependencies to add

```
prod:
  mongoose        ^8
  bcryptjs        ^2     (pure-JS, no native build)
  jsonwebtoken    ^9
  joi             ^17

dev:
  (none — no test framework, no testing per non-goals)
```

`cookie-parser` not added (plain bearer tokens, not cookie-based).

Env additions in `src/config/env.js` and `.env.example`:
```
MONGO_URI=mongodb://localhost:27017/ecommerce
BCRYPT_ROUNDS=10
OTP_DUMMY=true
OTP_EXPIRY_MIN=10
RESET_TOKEN_EXPIRY_MIN=30
```

`env.js` validates at startup: throws if `JWT_SECRET` is missing, empty, or shorter than 32 chars. Throws if `MONGO_URI` is missing.

---

## File-by-file plan

```
src/
├── config/
│   ├── env.js              EXTEND  add MONGO_URI, BCRYPT_ROUNDS, OTP_DUMMY, *_EXPIRY_MIN;
│   │                                fail-fast validation on JWT_SECRET length + MONGO_URI presence
│   └── db.js               NEW     mongoose.connect + retry; on connect, run
│                                    db.admin().command({hello:1}) and verify the
│                                    response indicates replica-set mode (setName
│                                    field present). Refuse to start otherwise with:
│                                    "Mongo must run in replica-set mode for
│                                    transactions. Run `docker compose up` to start
│                                    a local replica set (see docker-compose.yml)."
├── models/
│   ├── Auth.js             NEW     auth schema + indexes + toJSON transform (strips secrets)
│   └── User.js             NEW     user schema (flat profile fields) + indexes
├── routes/
│   ├── auth.routes.js      REWRITE 8 endpoints (see API surface)
│   └── user.routes.js      REWRITE /users/me + admin /users + /users/:id
├── controllers/
│   ├── auth.controller.js  REWRITE thin: parse req → call service → shape res
│   └── user.controller.js  REWRITE thin
├── services/
│   ├── auth.service.js     REWRITE register, verifyOtp, resendOtp, login, logout,
│   │                                forgotPassword, resetPassword, changePassword,
│   │                                setAccountStatus (helper: mongoose.startSession +
│   │                                session.withTransaction wrapping both writes,
│   │                                same code path in dev and prod)
│   ├── otp.service.js      NEW     generate(), verify() — branches on OTP_DUMMY
│   ├── token.service.js    NEW     signJwt, verifyJwt, sha256, randomToken
│   └── user.service.js     REWRITE getMe, updateMe (allowlist via joi),
│                                    softDeleteSelf, listUsers (admin),
│                                    getUserById (admin), softDeleteUser (admin)
├── middleware/
│   ├── requireAuth.js      NEW     verify JWT signature → extract authId →
│   │                                load user from DB by authId → if not found
│   │                                OR user.deletedAt set: 401 "invalid credentials"
│   │                                → else set req.authId + req.user (fresh from DB
│   │                                every request). With always-txn, user.deletedAt
│   │                                is always in sync with auth.deletedAt, so checking
│   │                                only user.deletedAt suffices (saves an auth.findOne).
│   ├── requireRole.js      NEW     factory: requireRole('admin'). Reads req.user.role
│   │                                (already loaded fresh by requireAuth). 403 if mismatch.
│   └── validate.js         NEW     joi schema factory → ApiError(400)
└── utils/
    └── ApiError.js         REUSE  (exists)

scripts/
└── create-admin.js         NEW     interactive CLI: prompt email/username/password,
                                    insert auth + users with role='admin', isVerified=true

(repo root)
├── docker-compose.yml      NEW     single-node Mongo replica set for local dev:
│                                    services.mongo: image mongo:7,
│                                    command ["--replSet","rs0","--bind_ip_all"],
│                                    ports ["27017:27017"], healthcheck that runs
│                                    rs.initiate() if not yet initiated.
│                                    Usage: `docker compose up -d` then `npm run dev`.
└── README.md               UPDATE  add a "Local development" section pointing at
                                    docker-compose + how to run create-admin script.
```

**Reuse:** `src/utils/ApiError.js`, `src/middleware/asyncHandler.js`, `src/middleware/errorHandler.js`, `src/middleware/notFoundHandler.js` — already in place, no changes needed.

No `test/` directory — automated testing is out of scope.

---

## Failure modes (production realism)

Without automated tests, every failure mode below relies on the runtime error handler doing the right thing. Manual verification is the only safety net before merging.

| Codepath              | Realistic failure                        | Handler? | User sees?           |
|-----------------------|------------------------------------------|----------|----------------------|
| `register` → both inserts | second user with same email, racing the unique index | ✓ catch E11000 → 409 | "email or username already in use" |
| `register` → both inserts | `users` insert fails after `auth` insert | ✓ Mongo txn rolls both back atomically | 500 generic; user retries cleanly with no orphan state |
| `verifyOtp` → `setAccountStatus` | second write to `users` fails | ✓ Mongo txn rolls auth write back | 500 generic; user retries verify-otp |
| boot                  | Mongo not in replica-set mode            | ✓ refuse to start | startup log + exit (clear "run docker compose up" message) |
| `verifyOtp`           | clock skew makes OTP "expired" early     | ✓ tolerant ±1min | 400 valid error      |
| `login`               | bcrypt CPU spike under load              | timeout via Express | 500 generic          |
| `login`               | deleted account tries to log in          | ✓ 401 generic | identical to bad-password |
| `requireAuth`         | JWT_SECRET rotated; old tokens fail      | ✓ 401     | force re-login       |
| `requireAuth`         | user deleted via DELETE /users/me but JWT still valid | ✓ DB load + check deletedAt → 401 | next API call boots them out |
| `forgotPassword`      | reset token leaks via referer header     | mitigated by single-use + 30min expiry | n/a |
| boot                  | JWT_SECRET unset / too short             | ✓ refuse to start | startup log + exit |
| boot                  | MONGO_URI unset                          | ✓ refuse to start | startup log + exit |

No silent failures permitted — every error path returns an `ApiError` with code + message.

**No critical gaps:** transactions eliminate the partial-failure orphan-state class entirely. Same code path in dev and prod, no environment-conditional behavior. Either both writes commit or neither does.

---

## Open risks (acknowledged, not solved)

1. **No automated tests** — auth code is the most-attacked surface in any backend (password hashing, OTP verification, JWT validation, identity changes). A regression in any of these is invisible until production. Manual curl verification catches happy paths but not the 95% of edge cases tests would catch (expired tokens, replay attacks, OTP attempt caps, etc.). Acceptable per user direction; revisit before production.
2. **Plain JWT 7d, no revocation** — stolen token works until expiry. Mitigation: requireAuth loads fresh user from DB on every request and rejects soft-deleted users with 401, so a deleted user's outstanding token IS effectively invalidated. Stolen tokens from non-deleted users still work for 7 days. Acceptable per user choice; revisit when refresh tokens land.
3. **OTP_DUMMY in prod** — refusing to start, or loud startup warning, when `NODE_ENV=production && OTP_DUMMY=true`. Decision: **loud warning only**, refuse-to-start would break local prod-like testing.
4. **Admin bootstrap is manual** — `scripts/create-admin.js` must be run by hand on every fresh deploy. Easy to forget on staging/preview environments. Mitigation: document in README + deploy runbook.
4a. **Seed script does NOT use a transaction** (accepted inconsistency). Unlike `register` and `setAccountStatus`, `scripts/create-admin.js` performs the two inserts sequentially without `session.withTransaction()`. If the second insert fails, an orphan `auth` row remains; re-running the script hits E11000 and prompts elevation for a non-existent `users` doc. Operator must manually clean up via mongo shell. Acceptable per user direction; in practice this requires a Mongo failure between two sequential inserts during one-off admin setup.
5. **Replica-set requirement (everywhere)** — Mongo must run in replica-set mode (or sharded cluster) for transactions. Standalone Mongo will not boot. Dev cost: `docker compose up -d` instead of `mongod`. The bundled `docker-compose.yml` runs a single-node replica set and auto-initiates it on first start. Atlas free tier also works (always replica set). Eliminates a whole class of denorm-drift bugs and keeps dev and prod on the same code path.
6. **DB-load-per-request cost** — requireAuth now does a `User.findOne({authId})` on every authed request. With the unique index on `authId`, this is sub-millisecond. Adds latency under heavy load. Acceptable; revisit if requireAuth shows up in a profile.

---

## Verification (manual, after implementation)

```
1. npm install
2. docker compose up -d  (starts local Mongo replica set; first start auto-runs rs.initiate())
3. cp .env.example .env  (set MONGO_URI=mongodb://localhost:27017/ecommerce?replicaSet=rs0, JWT_SECRET ≥32 chars, OTP_DUMMY=true)
4. npm run dev  (boot succeeds. Try empty JWT_SECRET → refuses to start. Stop docker, try a standalone mongod on 27017 → app refuses to boot with "run docker compose up".)
5. node scripts/create-admin.js  (creates the first admin; capture the token by logging in as admin in step 9 below)
6. POST /api/v1/auth/register { email, username, password }
   → 201 { authId, message }
   → console: "OTP for <email>: 1234"
7. POST /api/v1/auth/register { email, username, password }  (same email — should 409)
   → 409 "email or username already in use"
8. POST /api/v1/auth/verify-otp { authId, otp:"1234" }
   → 200 { token, user }
9. POST /api/v1/auth/login { emailOrUsername, password } (also: log in as the admin from step 5)
   → 200 { token, user }
10. GET /api/v1/users/me  (Authorization: Bearer <token>)
    → 200 user (with empty profile fields at top level — no `profile` wrapper)
11. PATCH /api/v1/users/me { bio:"hi", picture:"https://...", phone:"+1..." }
    → 200 (verify fields land at top level on the user doc)
12. PATCH /api/v1/users/me { email:"new@x.com" }
    → 400 "unknown field" (joi allowlist rejection)
13. POST /api/v1/auth/change-password { currentPassword, newPassword } → 200
14. POST /api/v1/auth/forgot-password { email } → 200, console logs reset token
    POST /api/v1/auth/reset-password { token, newPassword } → 200
15. DELETE /api/v1/users/me → 200
    Verify in mongo shell: db.auth.findOne({email}).deletedAt is set, db.users.findOne({email}).deletedAt is set
16. POST /api/v1/auth/login { emailOrUsername, password } (with the deleted account)
    → 401 "invalid credentials" (NOT a "deleted" message — same as bad-password to avoid enumeration)
17. With still-valid JWT from step 8, retry GET /api/v1/users/me
    → 401 "invalid credentials" (requireAuth's DB load finds users.deletedAt set)
18. With admin token from step 9: GET /api/v1/users → list excludes deleted
```

---

## Next steps

1. Run `/plan-eng-review` against this PRD for an architecture pass. ← in progress (pass 2)
2. On clean review: implement in a follow-up session — install deps, write models/services/middleware/scripts, run the manual verification above.
3. End-of-session ritual: capture the schema decision (`auth/users separation, flat profile fields, immutable email/username, no tests, soft-delete-both, seed-script admin bootstrap, no transactions / option C denorm sync, role-from-DB-not-JWT`) into `wiki/decisions/` and the signup/login flows into `wiki/flows/`.

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 3 | DONE_WITH_CONCERNS | passes 1+2 resolved 8 architecture issues; pass 3 found 2 more (username case-sensitivity → fixed, seed-script-no-txn → accepted); 0 code-quality blockers; 0 critical failure-mode gaps |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | n/a | backend-only |
| Outside Voice | optional | Cross-model challenge | 0 | skipped | per user pace |

- **UNRESOLVED:** 0 (all questions answered)
- **VERDICT:** ENG REVIEW DONE_WITH_CONCERNS — ready to implement, with three accepted-risk items: (1) no automated tests on auth code, (2) plain JWT 7d no revocation, (3) seed script's two inserts run without a transaction (orphan-auth-on-failure possible during one-off admin setup; manual mongo-shell cleanup required if it ever happens). The runtime orphan-state class is eliminated everywhere else by always-on transactions. All remaining risks documented in §Open risks.
