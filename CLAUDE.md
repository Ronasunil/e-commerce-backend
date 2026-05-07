# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project

E-commerce backend REST API built with Node.js and Express. ES modules (`"type": "module"`). Node >= 18.

## Commands

- `npm run dev` — start with `node --watch` (auto-reloads on file changes)
- `npm start` — production start
- `npm test` — run Node's built-in test runner
- `cp .env.example .env` — bootstrap local env config

Server defaults to `http://localhost:3000`. Health check: `GET /health`.

## Structure

What each folder is for. Place new files according to purpose — don't restructure to match a specific list.

```
src/
├── server.js       entry point — boots HTTP server, handles signals/shutdown
├── app.js          Express app — middleware stack + top-level route mounting
├── config/         environment & app-wide config. Read env vars here, nowhere else
├── routes/         route definitions per resource. One file per resource (e.g. foo.routes.js), mounted from index.js
├── controllers/    thin HTTP layer — parse req, call a service, shape the response. No business logic
├── services/       business logic and orchestration. Throws ApiError for expected failures
├── models/         data models / persistence (schemas, repositories, ORM bindings)
├── middleware/     custom Express middleware (auth, validation, error handling, etc.)
└── utils/          shared helpers with no domain ties (error classes, formatters, small pure functions)
```

**Where new code goes:**
- New resource? Add `<name>.routes.js`, `<name>.controller.js`, `<name>.service.js`, mount the router in `routes/index.js`.
- New cross-cutting concern (logging, rate limit, auth)? `middleware/`.
- New shared helper used in 2+ places? `utils/`.
- Talking to a DB or external API? `services/` (logic) + `models/` (schema/queries).

## Architecture conventions

- **Layering:** routes → controllers → services. Controllers stay thin; business logic belongs in services.
- **Errors:** throw `ApiError(status, message, details?)` from services. `asyncHandler` forwards rejections to `errorHandler`. Don't try/catch in controllers just to send a response.
- **Config:** import from `src/config/env.js`. Don't read `process.env` directly elsewhere.
- **API surface:** all resources under `/api/v1/...`. Add new resources by creating a route file and mounting it in `src/routes/index.js`.
- **Imports:** use explicit `.js` extensions (ESM requirement). Relative paths only within `src/`.

## Wiki — engineering memory

A sibling repo at `../e-commerce-wiki/` holds the team's persistent engineering memory: past decisions, bug playbooks, feature flows, concept pages. Treat it as **read-only reference material** during coding work.

### Consult the wiki before

| You're about to... | Check |
|---|---|
| Make a non-trivial design or architectural choice | `../e-commerce-wiki/wiki/decisions/` — has this been decided already? Has it been *re-litigated* and we landed somewhere different? |
| Debug a non-trivial bug | `../e-commerce-wiki/wiki/bugs/` — same symptom seen before? Saves re-tracing. |
| Implement or modify a feature | `../e-commerce-wiki/wiki/flows/` — read the existing flow page first. Don't reinvent the description. |
| Hear a familiar pattern name (e.g. "soft-delete", "idempotency key") | `../e-commerce-wiki/wiki/concepts/` — there's likely a page on it. |
| Get asked "why is this done this way?" or "have we discussed X before?" | Wiki first, then code. The answer to "why" lives in `decisions/`, not the source. |

### How to consult

1. Read `../e-commerce-wiki/index.md` first — it's the catalog. One read tells you what exists.
2. Open only the 1–3 pages that look relevant (don't load the whole wiki).
3. **Cite when you use it.** "Per `../e-commerce-wiki/wiki/decisions/use-mongodb.md`, we chose Mongo because of nested attributes — sticking with that here." This lets the user verify and trust.
4. If the wiki contradicts what the user just asked for → flag it, don't silently override either side.

### When to skip the wiki

- Trivial work (renames, lint fixes, typos, formatting)
- Clearly unrelated to anything documented (a brand-new domain)
- The wiki is empty for the relevant section — that's fine, proceed

### Don't write to the wiki mid-session

Only the **end-of-session ritual** writes to the wiki. Don't update it during coding. Mid-session edits fragment the state and break the schema. The wiki gets one coherent update at the end.

### End-of-session capture

When a session produces something worth remembering (decision, non-trivial bug fix, shipped feature, non-obvious discovery), the user will paste the capture-session prompt. At that point: read `../e-commerce-wiki/CLAUDE.md` for the schema, write the raw note + ingest, report back. See `../e-commerce-wiki/APPROACH.md` for the full ritual.

## gstack

Use the `/browse` skill from gstack for **all** web browsing. **Never** use `mcp__claude-in-chrome__*` tools.

Available gstack skills:

- `/office-hours`
- `/plan-ceo-review`
- `/plan-eng-review`
- `/plan-design-review`
- `/design-consultation`
- `/design-shotgun`
- `/design-html`
- `/review`
- `/ship`
- `/land-and-deploy`
- `/canary`
- `/benchmark`
- `/browse`
- `/connect-chrome`
- `/qa`
- `/qa-only`
- `/design-review`
- `/setup-browser-cookies`
- `/setup-deploy`
- `/setup-gbrain`
- `/retro`
- `/investigate`
- `/document-release`
- `/codex`
- `/cso`
- `/autoplan`
- `/plan-devex-review`
- `/devex-review`
- `/careful`
- `/freeze`
- `/guard`
- `/unfreeze`
- `/gstack-upgrade`
- `/learn`
