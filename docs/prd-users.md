# PRD — User Management Feature

> Status: draft, pending eng review. Owner: tech@tghtech.com. Date: 2026-05-07. Branch: `main`.

## Context

The auth feature shipped in commit `92f358b` and is `implemented` per `../e-commerce-wiki/wiki/flows/auth.md`. It already exposes a partial user surface:

- Self-service: `GET /users/me`, `PATCH /users/me`, `DELETE /users/me`
- Admin: `GET /users` (unbounded list, no filters), `GET /users/:id`, `DELETE /users/:id`

The wiki summary explicitly flags four decisions as **open** for the user-management slice:
- admin list pagination/search API shape
- admin role changes (promote/demote)
- admin suspend/reactivate semantics — separate from soft-delete?
- restore soft-deleted users — in scope?

This PRD closes those four decisions and specifies the missing admin capabilities that support and ops actually need: find users by attribute, change roles safely, temporarily block accounts without destroying them, and restore deleted accounts. It deliberately **does not** expand admin powers into editing other users' profile fields — profile data remains user-owned.

### Decisions locked in (this PRD)

- **Suspend uses a new `suspendedAt` timestamp**, denormalized onto **both** `auth` and `users` collections. Distinct from `deletedAt`. Both fields can be set on the same record independently.
- **Login and `requireAuth` both gate on EITHER `deletedAt` or `suspendedAt`.** A suspended account cannot log in, and existing JWTs stop working on the next request. Both surfaces return the **same** distinct status for suspended (`403 "account suspended"`) — no asymmetry between login-time and authed-request-time.
- **Admins cannot edit other users' profile fields** (bio, picture, phone, address, dateOfBirth, gender). Admin powers are: list/get/role-change/suspend/unsuspend/delete/restore. Profile data stays user-owned.
- **Restore is in scope.** Soft-delete becomes reversible by an admin via `POST /users/:id/restore`. Self-soft-delete is also reversible by an admin (no separate user-self-restore endpoint).
- **No automated tests** for this slice — matches `wiki/decisions/no-automated-tests-mvp` and the prior auth pattern. Manual verification via `scripts/users.http`.
- **Pagination shape change to `GET /users`** is a breaking change to the existing response (currently a bare array). Acceptable because the feature is pre-production with no external consumers.
- **Action-style admin endpoints** (`POST /users/:id/suspend`, `/unsuspend`, `/restore`) over a generic `PATCH /users/:id { status }`. Reads cleanly in audit logs and the team explicitly decided **not** to expose a generic admin-update path on user records.

### Where this PRD lives

- Repo: `docs/prd-users.md` (this file)
- Plan file: `/home/rona/.claude/plans/next-step-is-to-swirling-wren.md` (earlier exploratory plan; superseded by this PRD)
- **Wiki**: not written mid-session per `../e-commerce-wiki/CLAUDE.md` and `../e-commerce-wiki/APPROACH.md`. End-of-session capture promotes the suspend-vs-delete decision and the new admin flow into the wiki.

---

## Goals

1. Admins can find users efficiently: paginate, full-text-substring search by email or username, filter by role, by verification, by lifecycle status (active / suspended / deleted / all).
2. Admins can promote a user to admin or demote an admin to user, with safety rails: cannot demote yourself, cannot demote the last admin.
3. Admins can suspend an account (block login + invalidate live sessions) without destroying it, and reverse the suspension.
4. Admins can restore a soft-deleted account.
5. State changes (suspend/unsuspend/restore/delete) remain atomic across `auth` and `users` — same transactional pattern the auth feature uses today.
6. Role and status changes take effect on the **next request** — no JWT rotation needed (already true thanks to fresh-from-DB role loading).

## Non-goals (NOT in scope)

- **Admin editing of other users' profile fields** (bio, picture, phone, address, dateOfBirth, gender). Profile data stays user-owned. If a support case ever needs this, the user can be asked to update it themselves, or the admin can suspend pending corrections.
- **Bulk operations** (suspend N users at once, change role for a list, etc.). Single-target endpoints only — revisit when ops actually has a bulk use case.
- **Audit log** of admin actions. Console logging via `morgan` is the only trail for now. Revisit before production.
- **User-initiated account restoration** (a user un-deleting themselves). Restoration is admin-only.
- **Email / username changes** — explicitly forbidden by `wiki/decisions/email-username-immutable-and-denormalized`. No endpoints, ever.
- **Rate limiting** on admin endpoints. Acknowledged as a gap (see Open risks).
- **Automated tests.** Manual smoke only.
- **Soft-delete-by-self restore by self.** A self-deleted user cannot un-delete themselves; an admin must do it.
- **Reason / note capture on suspend.** No `suspendedReason` field. Revisit if support asks.
- **Notifications** to the user when role / status flips.

---

## Data model

### Schema additions

Add **one** field to each existing collection. Denormalized identically per the established pattern.

```
auth (collection)                       users (collection)
  ...existing fields...                   ...existing fields...
  deletedAt                               deletedAt
  suspendedAt    ← NEW                    suspendedAt    ← NEW
  createdAt, updatedAt                    createdAt, updatedAt
```

```js
// src/models/Auth.js  — add after deletedAt
suspendedAt: { type: Date, default: null },

// src/models/User.js  — add after deletedAt
suspendedAt: { type: Date, default: null },
```

### Indexes

No new indexes. `deletedAt` and `suspendedAt` are loaded with the document and checked in code, not used as query filters at scale (admin list is rare). If the admin list grows slow, add a partial compound index `{ deletedAt: 1, suspendedAt: 1 }` later.

### State matrix

A user record has **two independent boolean-ish flags** that together produce four lifecycle states:

| `deletedAt` | `suspendedAt` | State        | Login? | Existing JWT works? |
|-------------|---------------|--------------|--------|---------------------|
| null        | null          | **active**   | yes    | yes                 |
| null        | set           | **suspended**| no     | no                  |
| set         | null          | **deleted**  | no     | no                  |
| set         | set           | **deleted**  | no     | no                  |

Deleted dominates suspended for display purposes. Restore clears `deletedAt` only; if `suspendedAt` is also set, the restored user remains suspended until separately unsuspended. The two flags are independent — deliberately so, so an admin can suspend a user, then if the user requests deletion, the suspend record is preserved through the delete.

### Why a separate `suspendedAt` field (not reuse `deletedAt`)

Considered: collapse suspend into soft-delete. Rejected because:
1. **Audit signal lost.** "User deleted their account" is fundamentally different from "admin paused this account pending investigation." Mashing them into a single `deletedAt` field destroys provenance.
2. **Authorization scopes differ.** A user can soft-delete themselves; only an admin can suspend.
3. **Restore semantics diverge.** Reversing a self-deletion (apologetic email, "can I have my account back?") is different from lifting an admin suspension (investigation closed). Same underlying SQL — different operational meaning, different downstream notifications when those land.
4. **State transitions can compose.** A user in dispute can be suspended, then deleted, and the suspension state is preserved through the restore.

Cost: one extra Date column per collection. Cheap.

### Atomic dual-collection writes

Reuse `authService.setAccountStatus(authId, fields)` from `src/services/auth.service.js:21-31` exactly as-is. It already wraps `Auth.updateOne` and `User.updateOne` in a `session.withTransaction`. It accepts an arbitrary `fields` object, so it works unchanged for:

- `setAccountStatus(authId, { suspendedAt: new Date() })` — suspend
- `setAccountStatus(authId, { suspendedAt: null })` — unsuspend
- `setAccountStatus(authId, { deletedAt: null })` — restore

Role lives only on `users.role`. Role updates do NOT need a transaction — single-collection write via `User.findOneAndUpdate`.

---

## Flows

### Suspend

```
POST /api/v1/users/:id/suspend     (admin)
    │
    ▼
  validate :id is a valid ObjectId  → 404 "user not found" if not
    │
    ▼
  load target user (any state — admins see all)
    │
    ▼
  if not found → 404 "user not found"
  if target.deletedAt set → 409 "cannot suspend a deleted user"
  if target.suspendedAt set → 409 "user already suspended"
  if target.authId === actingAuthId → 400 "cannot suspend yourself"
  if target.role === 'admin' AND active-admin-count <= 1 → 400 "cannot suspend the last admin"
    │
    ▼
  setAccountStatus(target.authId, { suspendedAt: new Date() })
    │
    ▼
  200 { message: "user suspended", id, suspendedAt }
```

The suspended user's existing JWT stops working on the next request because `requireAuth` reloads the user and rejects on `suspendedAt`.

### Unsuspend

```
POST /api/v1/users/:id/unsuspend   (admin)
    │
    ▼
  validate :id  → 404 if invalid
    │
    ▼
  load target: User.findOne({ _id: id, suspendedAt: { $ne: null }, deletedAt: null })
    │
    ▼
  if not found → 404 "user not suspended"
  (deleted-and-suspended users are deliberately NOT surfaced here — the deletedAt: null
   clause excludes them. Admin must restore first if they want to return the account to
   active. This prevents the silent surprise of "unsuspend returned 200 but login still
   fails because the user is also deleted.")
    │
    ▼
  setAccountStatus(target.authId, { suspendedAt: null })
    │
    ▼
  200 { message: "user unsuspended", id }
```

### Restore (un-soft-delete)

```
POST /api/v1/users/:id/restore     (admin)
    │
    ▼
  validate :id  → 404 if invalid
    │
    ▼
  load target including deleted: User.findOne({ _id: id, deletedAt: { $ne: null } })
    │
    ▼
  if not found → 404 "user not deleted"
    │
    ▼
  setAccountStatus(target.authId, { deletedAt: null })
    │
    ▼
  200 { message: "user restored", id }
```

A restored user with `suspendedAt` still set remains suspended (independent flags). Admin must call unsuspend separately. The 200 response includes the user's resulting state so the admin sees it.

### Change role

```
PATCH /api/v1/users/:id/role  { role }   (admin)
    │
    ▼
  validate :id  → 404 if invalid
  validate body: role ∈ {'user', 'admin'}  → 400 if not
    │
    ▼
  load target with deletedAt: null AND suspendedAt: null
  (active users only — must reactivate before changing roles)
    │
    ▼
  if not found → 404 "user not found"
  if target.role === newRole → 200 no-op (idempotent, return current user)
  if target.authId === actingAuthId AND newRole !== 'admin' → 400 "cannot demote yourself"
  if target.role === 'admin' AND newRole !== 'admin':
        count = User.countDocuments({ role:'admin', deletedAt:null, suspendedAt:null })
        if count <= 1 → 400 "cannot demote the last admin"
    │
    ▼
  User.findOneAndUpdate({ _id: id }, { $set: { role: newRole } }, { new: true })
    │
    ▼
  200 user (with new role)
```

Effect is immediate on the target's next request, because `requireAuth` reloads the user from DB and `requireRole` reads `req.user.role` directly. No token rotation, no logout-other-sessions step.

### List users with filters

```
GET /api/v1/users?page=&limit=&q=&role=&isVerified=&status=    (admin)
    │
    ▼
  validate query (joi):
    page:        integer ≥ 1, default 1
    limit:       integer 1..100, default 20
    q:           string, trimmed, optional. Substring match on email OR username (case-insensitive regex on lowercased fields)
    role:        'user' | 'admin', optional
    isVerified:  boolean, optional (joi converts "true"/"false" strings)
    status:      'active' | 'suspended' | 'deleted' | 'all', default 'active'
    │
    ▼
  build filter:
    base = {}
    if q: base.$or = [{ email: rx }, { username: rx }] where rx = new RegExp(escape(q), 'i')
    if role: base.role = role
    if typeof isVerified === 'boolean': base.isVerified = isVerified
    status →
      'active'    : base.deletedAt = null;       base.suspendedAt = null
      'suspended' : base.deletedAt = null;       base.suspendedAt = { $ne: null }
      'deleted'   : base.deletedAt = { $ne: null }
      'all'       : (no deletedAt or suspendedAt clauses)
    │
    ▼
  Promise.all([
    User.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean(),
    User.countDocuments(filter)
  ])
    │
    ▼
  200 {
    data: [...],
    page, limit, total,
    totalPages: Math.ceil(total / limit)
  }
```

The current `GET /users` returns a bare array. New shape is an envelope. Pre-production change; call it out in the implementing commit message and PR description (no `CHANGELOG.md` exists in this repo — release notes live in commits).

`q` uses a regex on the (already lowercased, trimmed) `email` and `username` fields. For an MVP user count this is fine. Revisit with a Mongo text index or `$search` aggregation when the user count crosses ~10k.

---

## API surface (final, this PRD's additions are in **bold**)

```
PUBLIC
  POST   /api/v1/auth/register
  POST   /api/v1/auth/verify-otp
  POST   /api/v1/auth/resend-otp
  POST   /api/v1/auth/login
  POST   /api/v1/auth/forgot-password
  POST   /api/v1/auth/reset-password

AUTHED (requireAuth — already gates on deletedAt; this PRD adds suspendedAt gate)
  POST   /api/v1/auth/logout
  POST   /api/v1/auth/change-password
  GET    /api/v1/users/me
  PATCH  /api/v1/users/me
  DELETE /api/v1/users/me

ADMIN (requireAuth + requireRole('admin'))
  GET    /api/v1/users                          ← MODIFIED  pagination/filter/search; new envelope
  GET    /api/v1/users/:id
  DELETE /api/v1/users/:id
  PATCH  /api/v1/users/:id/role                 ← NEW
  POST   /api/v1/users/:id/suspend              ← NEW
  POST   /api/v1/users/:id/unsuspend            ← NEW
  POST   /api/v1/users/:id/restore              ← NEW
```

### Request / response shapes

**`PATCH /users/:id/role`**
```json
// request
{ "role": "admin" }

// response 200
{ "_id": "...", "role": "admin", ...rest of user }
```

**`POST /users/:id/suspend`** — empty body
```json
// response 200
{ "message": "user suspended", "id": "...", "suspendedAt": "2026-05-07T..." }
```

**`POST /users/:id/unsuspend`** — empty body
```json
// response 200 — returns resulting user state so admin sees full state
{ "message": "user unsuspended", "user": { "_id": "...", "suspendedAt": null, "deletedAt": null, ...rest } }
```

**`POST /users/:id/restore`** — empty body
```json
// response 200 — resulting state surfaces "deleted-AND-suspended → restore → still suspended"
{ "message": "user restored", "user": { "_id": "...", "deletedAt": null, "suspendedAt": "<set or null>", ...rest } }
```

**`GET /users` (modified)** — see flow above. New envelope:
```json
{
  "data": [ { ...user }, ... ],
  "page": 1,
  "limit": 20,
  "total": 137,
  "totalPages": 7
}
```

---

## Authorization & state guards

| Endpoint                       | Role  | Self-action allowed? | State guard on target                                                          |
|--------------------------------|-------|----------------------|---------------------------------------------------------------------------------|
| `GET /users`                   | admin | n/a                  | filter via query                                                                 |
| `GET /users/:id`               | admin | n/a                  | excludes deleted by default (existing behavior unchanged)                        |
| `PATCH /users/:id/role`        | admin | NO (no self-demote)  | target must be active (not deleted, not suspended); plus last-admin guard        |
| `POST /users/:id/suspend`      | admin | NO (no self-suspend) | target must be active; plus last-admin guard                                     |
| `POST /users/:id/unsuspend`    | admin | n/a (own session ok) | target must be currently suspended (and not deleted)                             |
| `POST /users/:id/restore`      | admin | n/a                  | target must be currently deleted                                                 |
| `DELETE /users/:id`            | admin | YES (admin can delete self — existing behavior, no new guard added) | existing                                                                         |

**Note on `DELETE /users/:id` self-action:** the existing endpoint has no last-admin guard. Adding one is out of scope for this PRD to keep the change surface tight; the `scripts/create-admin.js` idempotency path covers recovery. Tracked as a follow-up.

**Last-admin count guard** — extract as a private helper inside `user.service.js` and call from both `updateUserRole` and `suspendUser` (and any future admin self-delete guard):

```js
// private helper inside user.service.js
const _assertNotLastAdmin = async (target, action /* 'demote' | 'suspend' */) => {
  if (target.role !== 'admin') return;
  const activeAdmins = await User.countDocuments({
    role: 'admin',
    deletedAt: null,
    suspendedAt: null,
  });
  if (activeAdmins <= 1) {
    throw new ApiError(400, `cannot ${action} the last admin`);
  }
};
```

DRY'd up front because the same guard lands in 2+ call sites in this PRD; admin self-delete guard (currently a follow-up) would be the third.

---

## Validation

New joi schemas in `src/middleware/validators/user.validators.js`:

```js
export const updateRoleSchema = Joi.object({
  role: Joi.string().valid('user', 'admin').required(),
}).unknown(false);

export const listUsersQuerySchema = Joi.object({
  page:       Joi.number().integer().min(1).default(1),
  limit:      Joi.number().integer().min(1).max(100).default(20),
  q:          Joi.string().trim().allow(''),
  role:       Joi.string().valid('user', 'admin'),
  isVerified: Joi.boolean(),
  status:     Joi.string().valid('active', 'suspended', 'deleted', 'all').default('active'),
}).unknown(false);
```

`validate(schema, target)` middleware factory at `src/middleware/validate.js` already supports `target='query'` (line 8 — `target = 'body'` default). Wire as `validate(listUsersQuerySchema, 'query')`.

---

## File-by-file plan

```
src/
├── models/
│   ├── Auth.js                    EDIT  add suspendedAt field
│   └── User.js                    EDIT  add suspendedAt field
├── routes/
│   └── user.routes.js             EDIT  add 4 routes (PATCH role, POST suspend/unsuspend/restore);
│                                         wire validate(listUsersQuerySchema, 'query') on GET /
├── controllers/
│   └── user.controller.js         EDIT  add 4 handlers; modify listUsers to pass req.query
├── services/
│   ├── auth.service.js            EDIT  login(): also reject if auth.suspendedAt set →
│   │                                     ApiError(403, 'account suspended')
│   └── user.service.js            EDIT  rewrite listUsers({page,limit,q,role,isVerified,status});
│                                         add updateUserRole(actingAuthId, id, role),
│                                             suspendUser(actingAuthId, id),
│                                             unsuspendUser(id),
│                                             restoreUser(id)
├── middleware/
│   ├── requireAuth.js             EDIT  reject when user.suspendedAt set (alongside deletedAt)
│   └── validators/
│       └── user.validators.js     EDIT  add updateRoleSchema, listUsersQuerySchema

scripts/
└── users.http                     NEW   smoke probes mirroring scripts/auth.http style:
                                          list with filters, role change (incl. self-demote
                                          and last-admin guards), suspend/unsuspend
                                          (incl. self-suspend, last-admin), delete + restore
```

**Reuse without modification:**
- `authService.setAccountStatus` — `src/services/auth.service.js:21-31` (atomic dual-collection write)
- `requireRole('admin')` — `src/middleware/requireRole.js`
- `validate(schema, target)` — `src/middleware/validate.js`
- `ApiError` — `src/utils/ApiError.js`
- `asyncHandler` — `src/middleware/asyncHandler.js`
- `mongoose.isValidObjectId` ID-guard pattern — already used at `src/services/user.service.js:41-43`

No new dependencies. No env additions. No migration script (default `null` means existing rows are unaffected).

---

## Failure modes

Without automated tests, every failure mode below relies on the runtime error handler. Manual verification is the only safety net.

| Codepath                      | Realistic failure                                                              | Handler? | User sees?                        |
|-------------------------------|--------------------------------------------------------------------------------|----------|-----------------------------------|
| `suspendUser`                 | suspending the last admin (e.g., a single-admin system attempts self-suspend, blocked already; second-to-last admin tries to suspend the only other admin) | ✓ count guard | 400 "cannot suspend the last admin" |
| `updateUserRole`              | demoting yourself                                                              | ✓ self-id guard | 400 "cannot demote yourself"      |
| `updateUserRole`              | demoting the last admin                                                        | ✓ count guard | 400 "cannot demote the last admin"|
| `updateUserRole`              | role change race vs simultaneous demotion of another admin                     | guard reads countDocuments inside the same request; not atomic with the write. With single-digit admins this is acceptable. Worst-case both demotions succeed and zero admins remain — operator recovers via `scripts/create-admin.js`. | inconsistent — accepted risk |
| `suspendUser` / `restoreUser` | second collection update fails after first                                     | ✓ Mongo txn rolls both back atomically | 500 generic; admin retries cleanly |
| `requireAuth`                 | user gets suspended mid-session                                                | ✓ DB load + suspendedAt check → 403 "account suspended" | next API call boots them out (same status as login surface) |
| `login`                       | suspended user tries to log in                                                 | ✓ 403 "account suspended"           | distinct from deleted (so support can diagnose; intentionally NOT generic since suspend is admin-visible action, not user-private state) |
| `restoreUser`                 | restoring a non-deleted user                                                   | ✓ 404 "user not deleted"            | 404                               |
| `unsuspendUser`               | unsuspending a non-suspended user                                              | ✓ 404 "user not suspended"          | 404                               |
| `listUsers`                   | malformed query (`page=abc`, `status=foo`, `limit=9999`)                       | ✓ joi validation                    | 400 with details array            |
| `listUsers`                   | regex injection via `q` parameter                                              | ✓ regex-escape `q` before constructing RegExp (do NOT pass user input into RegExp constructor un-escaped) | safe                              |
| `updateUserRole`              | target is a deleted/suspended user                                             | ✓ filter excludes them              | 404 "user not found"              |
| `restoreUser`                 | target was suspended at delete time; admin restores expecting full reactivation | n/a (by design) — restored user remains suspended; admin must unsuspend separately. Response includes resulting state so admin sees the situation. | 200 with state           |

**Login error message asymmetry — by design:**
- Deleted: 401 "invalid credentials" (matches bad-password to avoid enumeration; existing behavior unchanged)
- Suspended: 403 "account suspended" — a suspended user knows they're suspended (admin-driven action, not user-private)

---

## Open risks (acknowledged, not solved)

1. **No automated tests** — same risk as auth. Suspend/restore/role-change touch the auth boundary on every authed request, so a regression in `requireAuth`'s suspended check is invisible until production. Acceptable per `wiki/decisions/no-automated-tests-mvp`. **Highest priority of any item to revisit before production.**
2. **Last-admin race** — the count guard for demote/suspend reads `countDocuments` outside any transaction. Two admins demoting each other simultaneously could end with zero admins. Acceptable for MVP; mitigation is `scripts/create-admin.js` idempotency. Revisit with a transactional check-and-set if it ever fires.
3. **No audit log** — admin actions go only to `morgan` request logs. A malicious or compromised admin can suspend/restore/change roles without a structured trail. Mitigation: morgan logs + Mongo's `updatedAt` timestamps on users. Revisit before production.
4. **No rate limiting on admin endpoints** — a compromised admin token can drain the system, suspend everyone, etc. Acceptable since admin tokens are tightly held. Revisit when rate limiting lands as a cross-cutting middleware.
5. **Suspend has no expiration** — admin-applied suspensions are indefinite until manually lifted. No `suspendUntil` field. Revisit if support workflows require time-limited suspensions.
6. **No notifications** — a user does not learn they were suspended/unsuspended/restored except by trying to log in. No email, no banner. Acceptable for MVP; revisit when an email provider lands (currently OTP_DUMMY).
7. **Restore semantics on deleted-AND-suspended users** — a restored user remains suspended. This is the correct behavior (independent flags) but might surprise an admin. Mitigated by including the resulting state in the restore response.
8. **`q` substring search performance** — case-insensitive regex on `email` and `username` does a full collection scan when `q` is set. Fine for MVP; revisit with text index when active user count crosses ~10k.
9. **Pagination response is a breaking change** to `GET /users`. No external consumers exist (pre-production), but if anyone has a script that expects an array, it'll break. Called out in the implementing commit message and PR description.

---

## Verification (manual, after implementation)

Prereqs identical to the auth feature: `docker compose up -d` (Mongo replica set), `.env` configured, `npm run dev` running, `node scripts/create-admin.js` to bootstrap an admin, a regular verified user to operate on.

Capture `@adminToken` and `@userToken` via `POST /auth/login`.

```
1. Schema: drop into mongosh, db.users.findOne() → confirm `suspendedAt: null` is on existing rows
   (Mongoose adds the default on next write; reads return null per schema default).

2. List with filters
   GET /api/v1/users?page=1&limit=2                       → envelope {data, page, limit, total, totalPages}
   GET /api/v1/users?q=<partial-email>                     → matches found
   GET /api/v1/users?q=<partial-username>                  → matches found (username branch of $or)
   GET /api/v1/users?q=                                    → empty q ignored, full list returned
   GET /api/v1/users?q=.*+                                 → regex special chars escaped, no error, no inflated match
   GET /api/v1/users?role=admin                            → only admins
   GET /api/v1/users?isVerified=true                       → only verified
   GET /api/v1/users?isVerified=false                      → only unverified
   GET /api/v1/users?status=suspended                      → empty initially
   GET /api/v1/users?status=deleted                        → empty initially
   GET /api/v1/users?status=all                            → includes everyone (incl. deleted+suspended)
   GET /api/v1/users?page=abc                              → 400 with details
   GET /api/v1/users?limit=9999                            → 400 (max 100)
   GET /api/v1/users (with @userToken)                     → 403

3. Role change
   PATCH /users/:userId/role { role: 'admin' }             → 200, target now admin
   PATCH /users/:userId/role { role: 'admin' } (idempotent) → 200 no-op (returns current user)
   PATCH /users/:adminOwnId/role { role: 'user' }          → 400 "cannot demote yourself"
   PATCH /users/:suspendedUserId/role { role: 'admin' }    → 404 (target must be active)
   PATCH /users/:deletedUserId/role { role: 'admin' }      → 404 (target must be active)
   (after demoting the only other admin) PATCH /users/:lastAdminId/role { role: 'user' } → 400 "last admin"

4. Suspend / unsuspend
   POST /users/:userId/suspend                             → 200, suspendedAt set
   mongosh: db.auths.findOne({_id:...}).suspendedAt        → confirm dual-collection write
   POST /auth/login (suspended user, valid creds)          → 403 "account suspended"
   GET /users/me (with old @userToken pre-suspend)         → 403 "account suspended" (matches login surface)
   POST /users/:userId/suspend (already suspended)         → 409
   POST /users/:deletedUserId/suspend                      → 409 "cannot suspend a deleted user"
   POST /users/:adminOwnId/suspend                         → 400 "cannot suspend yourself"
   (promote a second admin, demote the original; then) POST /users/:onlyAdminId/suspend → 400 "last admin"
   POST /users/:userId/unsuspend                           → 200, login works again
   POST /users/:userId/unsuspend (not suspended)           → 404
   (suspend then delete a user; then) POST /users/:id/unsuspend → 404 (deleted-and-suspended hidden)

5. Soft-delete + restore
   DELETE /users/:userId                                   → 200
   GET /users?status=deleted                               → includes them
   POST /users/:userId/restore                             → 200, deletedAt cleared, login works
   POST /users/:userId/restore (not deleted)               → 404
   (suspend then delete then restore) confirm restored user remains suspended; unsuspend separately.

6. Cross-collection consistency
   For each state-changing operation, mongosh:
     db.auths.findOne({_id:authId}).{deletedAt,suspendedAt}
     db.users.findOne({authId}).{deletedAt,suspendedAt}
   Both must always agree.

7. Authorization
   Every new admin endpoint with @userToken                 → 403
   Every new admin endpoint with no token                   → 401

8. Existing flows untouched
   POST /auth/register                                     → 201 (regression check)
   POST /auth/login (active user)                          → 200 (regression check)
   PATCH /users/me (still works with allowlist)            → 200
```

---

## Next steps

1. Eng review (`/plan-eng-review`) of this PRD.
2. On clean review, implement in a follow-up session.
3. Append smoke commands to `scripts/users.http`.
4. End-of-session capture promotes:
   - `wiki/decisions/suspend-vs-delete-separate-fields.md` (the "why a separate `suspendedAt`" reasoning above)
   - update `wiki/flows/auth.md` (or split into `wiki/flows/user-management.md`) with the new admin endpoints and state matrix
   - promote `setAccountStatus` to `wiki/concepts/` once it crosses the 3+ reference threshold (will hit it at suspend/unsuspend/restore)

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | not run |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | DONE_WITH_CONCERNS | 8 issues found, 5 applied (A1, A2, Q1, Q3, smoke gaps); 1 deferred (A4 wrong-state code consistency, taste); 1 informational (A3 controller-spec note); 1 critical gap (A2) **fixed**; 0 critical gaps remaining |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | not run |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | n/a (backend-only) |
| Outside Voice | optional | Cross-model challenge | 0 | — | skipped |

**APPLIED THIS PASS:**
- **A1** — `requireAuth` and `login` now return identical `403 "account suspended"`. No asymmetry between auth surfaces. Updated: §Decisions locked in, §Failure modes (`requireAuth` row), §Verification step 4.
- **A2** *(critical)* — `unsuspendUser` filter explicitly excludes deleted users (`deletedAt: null` clause). Comment and code now agree. Updated: §Flows → Unsuspend.
- **Q1** — `_assertNotLastAdmin(target, action)` extracted as a private helper inside `user.service.js`; called from `updateUserRole` and `suspendUser`. Updated: §Authorization & state guards → Last-admin count guard block.
- **Q3** — `CHANGELOG` references replaced with "commit message + PR description" (no `CHANGELOG.md` exists in repo). Updated: §Flows → List users (final paragraph), §Open risks #9.
- **Verification** — extended with 9 missing manual-smoke cases: empty/regex-special `q`, username-branch substring, `isVerified=true|false`, role idempotent no-op, role on inactive target, suspend on deleted, last-admin suspend, suspended-and-deleted unsuspend.

**DEFERRED:**
- **A4** — wrong-state status code standardization (409 vs 404). Taste call — current mix is internally defensible.
- **A3** — controller passes `req.authId` (acting admin) to role/suspend services. Implicit in the existing controller pattern; explicit reminder during implementation.

**UNRESOLVED:** 0
**VERDICT:** ENG REVIEW DONE_WITH_CONCERNS — ready to implement, with one accepted-risk taste call (A4) deferred. All five wiki-flagged constraints are honored. The only critical gap (A2 silent-success on suspended-and-deleted unsuspend) is fixed.
