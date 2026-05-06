# E-commerce Backend

Node.js + Express REST API.

## Quick start

```bash
cp .env.example .env
npm install
npm run dev
```

Server runs on `http://localhost:3000`. Health check: `GET /health`.

## Structure

```
src/
├── server.js            entry point — boots HTTP server
├── app.js               Express app + middleware wiring
├── config/              environment & app config
├── routes/              route definitions per resource
├── controllers/         HTTP layer — parses req, calls services
├── services/            business logic
├── models/              data models / persistence
├── middleware/          custom middleware (errors, async, etc.)
└── utils/               shared helpers (ApiError, etc.)
```

## API

Base path: `/api/v1`

- `POST /auth/register`, `POST /auth/login`
- `GET|POST /users`, `GET|PATCH|DELETE /users/:id`
- `GET|POST /products`, `GET|PATCH|DELETE /products/:id`
- `GET|POST /orders`, `GET|PATCH|DELETE /orders/:id`

Service methods currently throw `501 Not Implemented` — wire them up to your data layer of choice.
# e-commerce-backend
