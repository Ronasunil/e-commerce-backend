# E-commerce Backend

Node.js + Express REST API. MongoDB + Mongoose. JWT auth.

See `docs/prd-auth.md` for the full auth spec and design decisions.

## Local development

You need Docker Desktop (or Docker Engine) running.

```bash
# 1. Install deps
npm install

# 2. Start Mongo (single-node replica set; transactions need it)
docker compose up -d

# 3. Set up env
cp .env.example .env
# Edit .env: set JWT_SECRET to at least 32 random chars

# 4. Create the first admin (one-shot, interactive)
node scripts/create-admin.js

# 5. Run the server
npm run dev
```

Server runs on `http://localhost:3000`. Health check: `GET /health`.

The app refuses to boot if:
- `JWT_SECRET` is missing or shorter than 32 characters
- `MONGO_URI` is missing
- Mongo is not in replica-set mode (transactions require it)

## API

Base path: `/api/v1`

**Public auth**
- `POST /auth/register` — `{ email, username, password }` → `201 { authId, message }`
- `POST /auth/verify-otp` — `{ authId, otp }` → `200 { token, user }`
- `POST /auth/resend-otp` — `{ authId }` → `200`
- `POST /auth/login` — `{ emailOrUsername, password }` → `200 { token, user }`
- `POST /auth/forgot-password` — `{ email }` → `200` (always; no enumeration)
- `POST /auth/reset-password` — `{ token, newPassword }` → `200`

**Authed (Bearer JWT)**
- `POST /auth/logout` (no-op for plain-JWT)
- `POST /auth/change-password` — `{ currentPassword, newPassword }`
- `GET /users/me`
- `PATCH /users/me` — picture, bio, dateOfBirth, gender, phone, address (allowlist)
- `DELETE /users/me` (soft-delete)

**Admin (`role=admin`)**
- `GET /users`
- `GET /users/:id`
- `DELETE /users/:id`

## OTP (dev mode)

`OTP_DUMMY=true` (default in `.env.example`) makes `verify-otp` accept `"1234"` regardless. Production must set `OTP_DUMMY=false` and wire a real provider in `src/services/otp.service.js`.

## Structure

```
src/
├── server.js            entry — connects Mongo, boots HTTP, handles signals
├── app.js               Express app + middleware
├── config/
│   ├── env.js           env loading + fail-fast validation
│   └── db.js            mongoose.connect + replica-set check
├── models/              Mongoose schemas (Auth, User)
├── routes/              one file per resource
├── controllers/         thin HTTP layer
├── services/            business logic (auth, user, token, otp)
├── middleware/
│   ├── requireAuth.js   verify JWT + load user from DB
│   ├── requireRole.js   role gate (read req.user.role)
│   ├── validate.js      joi schema factory → ApiError(400)
│   └── validators/      joi schemas per resource
└── utils/
    └── ApiError.js      custom error type with status + details

scripts/
└── create-admin.js      one-shot CLI to bootstrap the first admin
```

## Testing

No automated tests by design (per `docs/prd-auth.md` §Open risks #1). Manual verification flows live in the PRD §Verification.
