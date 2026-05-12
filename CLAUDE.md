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

## Engineering memory — wiki (Obsidian vault)

The team's persistent engineering memory lives in the **Obsidian vault at `../e-commerce-wiki/`** as plain markdown files. All past decisions, bug playbooks, feature flows, sessions, PRDs, and concept pages live there as `.md` files. **The wiki is the source of truth. Do not use gbrain for retrieval or writes — read and write the markdown files directly.**

> **Hard rule: always search the wiki first before answering anything non-trivial.** Use `Grep`/`Read`/`Glob` against `../e-commerce-wiki/` (and `find`/`grep`/`rg` via Bash). Never call `gbrain *` or `mcp__gbrain__*` tools for engineering memory — they are out of scope for this project.

### Per-prompt flow (run on every user prompt)

Every inbound user prompt is a **signal**. Run this cycle before answering:

1. **Signal detect (parallel, never blocks).** As you read the prompt, note any signal-worthy items: decisions being made, bugs being reproduced, reusable patterns, architectural tradeoffs, original thinking, non-obvious discoveries, or named entities (features, flows, concepts, bugs). Do not write anything yet — just register them mentally for step 5.
2. **Wiki-first lookup.** Before answering anything non-trivial, search the wiki for anything related. Default approaches:
   - `Grep` for key terms across `../e-commerce-wiki/wiki/` and `../e-commerce-wiki/raw/`.
   - `Glob` to list files under `../e-commerce-wiki/wiki/<decisions|flows|bugs|concepts>/`.
   - `Read` the 1–3 most relevant pages in full.
   - Start at `../e-commerce-wiki/index.md` for a curated map; check `../e-commerce-wiki/log.md` for the recent session timeline.
   - Skip only for trivial work (renames, typos, lint, formatting) or clearly novel domains.
3. **Respond with full context.** Answer the user grounded in what you found. **Cite the wiki paths inline** ("per `../e-commerce-wiki/wiki/decisions/<slug>.md`, …") so the user can verify. If the wiki contradicts the request, flag it — don't silently override either side. If the wiki had nothing relevant, say so briefly ("nothing in the wiki on this yet").
4. **Surface signals + propose next steps.** If step 1 detected anything worth saving, surface it as a one-line suggestion using the format in the *Per-session signal detection* subsection (`💡 Worth saving to wiki: <type> — "<title>"`). Then list **"Next steps:"** as a short numbered list of what you'd do if the user agrees (e.g. "1. write `wiki/decisions/<slug>.md`, 2. update `wiki/flows/<feature>.md`, 3. implement X"). End your reply there — do not start writing or implementing yet.
5. **Wait for explicit agreement.** Only proceed to the write/implement steps when the user says "yes", "agree", "go", "save to wiki", "write it", or similar. Until then, the cycle ends at step 4. This applies to both wiki writes *and* non-trivial code changes that flow from a detected signal.
6. **On agreement — write the markdown directly.** When the user agrees:
   - Pick the right page type (see schema below) and slug.
   - Build the markdown with proper frontmatter and inline `[Source: ...]` citations.
   - Write the file directly with the `Write` tool to `../e-commerce-wiki/<path>/<slug>.md`. Use Obsidian-style `[[wikilinks]]` between related pages.
   - Append a one-line entry to `../e-commerce-wiki/log.md` (date + slug + one-line summary).
   - Report the file paths created/updated.

**Shape of the per-prompt reply (when signals are present):**

```
<answer to the user's question, with wiki citations>

💡 Worth saving to wiki: <type> — "<short title>"

Next steps:
1. <action>
2. <action>
3. <action>

Say "yes" / "agree" / "save to wiki" to proceed.
```

When no signals fire and no wiki hits are relevant, just answer normally — don't add ceremonial "nothing to save" blocks.

### Schema (page types)

| Type | Path pattern | What it captures |
|---|---|---|
| `decision` | `../e-commerce-wiki/wiki/decisions/<slug>.md` | Architectural choices, tradeoffs, why we picked X over Y. |
| `flow` | `../e-commerce-wiki/wiki/flows/<feature>.md` | End-to-end feature description (signup, products, etc). |
| `bug` | `../e-commerce-wiki/wiki/bugs/<slug>.md` | Reproducible bug + root cause + fix. |
| `concept` | `../e-commerce-wiki/wiki/concepts/<slug>.md` | Reusable patterns (soft-delete, idempotency key, set-account-status). |
| `feature` (PRD) | `../e-commerce-wiki/raw/features/<date>-<name>.md` | PRD as written before implementation. |
| `session` | `../e-commerce-wiki/raw/sessions/<date>-<name>.md` | Session log: what shipped, what surprised. |

### Consult the wiki before

| You're about to... | Do |
|---|---|
| Make a non-trivial design or architectural choice | `ls ../e-commerce-wiki/wiki/decisions/` then `Read` the relevant ones. Has this been decided already? Re-litigated? |
| Debug a non-trivial bug | `Grep "<symptom>" ../e-commerce-wiki/wiki/bugs/`. Same symptom seen before? Saves re-tracing. |
| Implement or modify a feature | `Read ../e-commerce-wiki/wiki/flows/<feature>.md` — read the existing flow page first. Don't reinvent the description. |
| Hear a familiar pattern name (e.g. "soft-delete", "idempotency key") | `Grep "<pattern>" ../e-commerce-wiki/wiki/concepts/`. |
| Get asked "why is this done this way?" or "have we discussed X before?" | Wiki first, then code. The answer to "why" lives in `wiki/decisions/`, not the source. |

### How to consult

1. Start with `Grep "<terms>" ../e-commerce-wiki/` for keyword hits across the vault.
2. Narrow by subdirectory: `wiki/decisions/`, `wiki/flows/`, `wiki/bugs/`, `wiki/concepts/`, `raw/features/`, `raw/sessions/`.
3. Open the 1–3 most relevant pages with `Read`.
4. **Cite when you use it.** "Per `../e-commerce-wiki/wiki/decisions/jwt-no-refresh-no-revocation.md`, we picked plain JWT because of infra minimalism — sticking with that here." This lets the user verify and trust.
5. If the wiki contradicts what the user just asked for → flag it, don't silently override either side.

### When to skip the wiki

- Trivial work (renames, lint fixes, typos, formatting).
- Clearly unrelated to anything documented (a brand-new domain).
- The wiki is empty for the relevant section — that's fine, proceed.

### Don't write mid-session

Only the **end-of-session ritual** writes to the wiki. Don't `Write` new wiki pages during coding. Mid-session edits fragment state and break the schema. The wiki gets one coherent update at the end.

### Per-session signal detection (every session, always-on)

Notice and suggest, **don't write**. Trigger a brief one-line suggestion to the user whenever any of these surface during work:

- A non-obvious decision is made (we picked X over Y because Z)
- A bug is reproduced + root-caused + fixed
- A reusable pattern emerges (something that will likely repeat)
- An architectural choice or tradeoff gets resolved
- A non-trivial discovery about the codebase, infra, or domain
- The user states original thinking (a thesis, framework, strong opinion) — capture exact phrasing

**Suggestion format (one line, non-blocking):**

> 💡 Worth saving to wiki: `<type>` — "<short title>". Say "save to wiki" to write.

Do NOT write to the wiki on detection. Do NOT interrupt the flow. Just surface the suggestion and continue. Multiple suggestions in a session are fine — batch them at the end if cleaner.

### Writing to the wiki (only on explicit user trigger)

When the user says **"save to wiki"**, **"write that down"**, **"capture this"**, or pastes the end-of-session capture prompt:

1. Brain-first: re-check the wiki for an existing page on this topic. If one exists, **update it** rather than creating a duplicate.
2. Pick the right page type from the schema table above (`decision` / `flow` / `bug` / `concept` / `feature` / `session`).
3. Build the markdown with proper frontmatter and inline `[Source: ...]` citations. Cross-link related pages with Obsidian-style `[[wikilink]]` syntax.
4. Use the `Write` tool to create/overwrite the file under `../e-commerce-wiki/`.
5. Append a one-line entry to `../e-commerce-wiki/log.md`.
6. Report back the paths created/updated.

### End-of-session capture

When a session produces something worth remembering (decision, non-trivial bug fix, shipped feature, non-obvious discovery), the user will paste the capture-session prompt. At that point:

1. Decide what types of pages this session produced: a new `session` log? A new `decision`? An updated `flow`? A new `bug`?
2. For each, build the markdown body with proper frontmatter:
   ```
   ---
   type: <decision|flow|bug|concept|feature|session>
   date: YYYY-MM-DD
   tags: [tag1, tag2]
   related: [[<other-slug>]], [[<other-slug>]]
   ---

   # Page title

   ## Section
   ...
   ```
3. `Write` to the appropriate path (e.g. `../e-commerce-wiki/wiki/decisions/<short-name>.md` for decisions, `../e-commerce-wiki/raw/sessions/<date>-<name>.md` for sessions — match the existing patterns).
4. Append to `../e-commerce-wiki/log.md`.
5. Report back: list the file paths created/updated.

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

## Wiki Search Guidance

The wiki at `../e-commerce-wiki/` is the only engineering-memory source. Prefer `Grep`/`Read`/`Glob` against it over any semantic-search tool. Do not call `gbrain` or `mcp__gbrain__*` — they are out of scope for this project.

Entry points:
- `../e-commerce-wiki/index.md` — curated map of the vault.
- `../e-commerce-wiki/log.md` — append-only session timeline.
- `../e-commerce-wiki/APPROACH.md`, `../e-commerce-wiki/WORKFLOWS.md` — vault conventions.
- `../e-commerce-wiki/wiki/{decisions,flows,bugs,concepts}/` — curated knowledge.
- `../e-commerce-wiki/raw/{features,sessions,notes,transcripts,linear,slack}/` — raw inputs (PRDs, session logs, etc).

How to search:
- "Where is X handled?" / semantic intent, no exact string yet → `Grep "<terms>" ../e-commerce-wiki/` then `Read` the top hits.
- "Has this been decided?" → `ls ../e-commerce-wiki/wiki/decisions/` and `Grep` filenames + bodies.
- "Same bug before?" → `Grep "<symptom>" ../e-commerce-wiki/wiki/bugs/`.
- "What did we ship last session?" → `Read ../e-commerce-wiki/log.md` (latest entries at top/bottom per vault convention) and the matching `raw/sessions/<date>-<name>.md`.

Grep is right for known exact strings, regex, multiline patterns, and file globs. For natural-language questions, fall back to reading `index.md` first to navigate.
