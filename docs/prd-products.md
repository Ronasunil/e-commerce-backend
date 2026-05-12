# PRD — Products Feature

> Status: draft, pending eng review. Owner: tech@tghtech.com. Date: 2026-05-07. Branch: `main`.

## Context

`auth` and `user-management` shipped (see `../e-commerce-wiki/wiki/flows/auth.md` and `../e-commerce-wiki/wiki/flows/user-management.md`). Two stub resources remain wired into the app: `products` and `orders`. `orders` depends on products existing, so this PRD covers products.

Today the product stack is empty scaffolding:

- `src/routes/product.routes.js` — CRUD routes wired, **no auth/role guards**
- `src/controllers/product.controller.js` — pass-through to service
- `src/services/product.service.js` — `list()` returns `[]`; everything else throws `ApiError(501, 'not implemented')`
- `src/models/Product.js` — **does not exist**

This PRD specifies the MVP catalog: admins author products, the public browses them. Storefront patterns kept deliberately lean — no variants, no separate categories collection, no image upload, no inventory reservation. Those are deferred to follow-up PRDs once the orders flow exposes real requirements.

### Decisions locked in (this PRD)

- **Minimal catalog schema** — `name`, `slug`, `description`, `price`, `currency`, `stockQty`, `images[]`, `category`, `isActive`, `deletedAt`. No variants, no separate `Category` collection, no SKU/UPC, no per-variant stock. Mirrors the lean MVP approach used in auth/users.
- **Soft delete + reversible restore** — products have a `deletedAt` timestamp. `DELETE /api/v1/products/:id` sets it; `POST /api/v1/products/:id/restore` clears it. Mirrors the user-management lifecycle pattern (`../e-commerce-wiki/wiki/decisions/suspend-vs-delete-separate-fields.md`). Order references survive delete — the document is still in the collection, just filtered out of public reads — so the orders PRD does not need a load-bearing snapshot pattern (it can still snapshot for price-history reasons, but correctness no longer depends on it).
- **`isActive` is the publish/unpublish flag** — independent of `deletedAt`. Defaults to `false` so new products are drafts. Combined with `deletedAt`, a product has four lifecycle states: **live** (`isActive=true, deletedAt=null`), **draft** (`isActive=false, deletedAt=null`), **deleted-from-live** (`isActive=true, deletedAt=set`), **deleted-from-draft** (`isActive=false, deletedAt=set`). Restore clears `deletedAt` only — the resulting product retains whatever `isActive` value it had at delete time. Admin must separately flip `isActive` if they want a different post-restore state.
- **Two URL families — storefront and admin.** Public reads at `/api/v1/products` (no auth middleware, returns only live products). All admin operations under `/api/v1/admin/products` (`requireAuth` + `requireRole('admin')`, full visibility across all four lifecycle states). No role-aware response shaping on a single endpoint — each URL has one job. Side benefit: the public catalog endpoint is naturally cacheable (no token-dependent response). Trade-off: an admin verifying "what shoppers actually see" hits a different URL than the admin-management view.
- **Images are URL strings only** — `images: [String]`. Admin pastes hosted URLs (S3/Cloudinary/etc). No upload endpoint, no multer, no `/uploads` directory. Any upload pipeline lives in a future PRD.
- **Currency stored per-product as an ISO 4217 string.** No multi-currency conversion logic. Reads return the price exactly as the admin entered it.
- **No automated tests** — matches `../e-commerce-wiki/wiki/decisions/no-automated-tests-mvp.md` and the prior auth/users pattern. Manual verification via `scripts/products.http`.

### Where this PRD lives

- Repo: `docs/prd-products.md` (this file)
- Plan file: `/home/rona/.claude/plans/sorted-booping-prism.md`
- **Wiki**: not written mid-session per `../e-commerce-wiki/CLAUDE.md` and `../e-commerce-wiki/APPROACH.md`. End-of-session capture promotes the soft-delete-and-isActive decision and the admin-namespace-split decision into the wiki (see §Next steps for the exact pages).

---

## Goals

1. Admins can create, update, soft-delete, restore, list, and read products via the admin URL family.
2. Admins can publish/unpublish a product without losing it (`isActive` toggle).
3. Anyone (anonymous or authenticated) can browse and read **live (published, non-deleted)** products via the public URL family. No login wall on the storefront.
4. The public list endpoint and the admin list endpoint are structurally distinct routes — same Mongo collection, different filter, different middleware, different URL.
5. Both list endpoints support pagination, substring search by `name`, and filter by `category`. The admin list additionally supports `?status=live|draft|deleted|all`.
6. Slug uniqueness is enforced across all products including deleted; an admin cannot reuse the slug of a soft-deleted product without restoring or hard-resolving it. See Open Risks #2 for the trade-off.

## Non-goals (NOT in scope)

- **Variants** (size/color, per-variant SKU, per-variant stock). One product = one stock count for MVP.
- **Categories collection.** `category` is a free-text lowercase string on the product. No `Category` model, no nested categories, no admin endpoints to manage categories. Revisit when the storefront actually needs grouping pages.
- **Image upload.** `images` is a string array of URLs the admin already hosts elsewhere. No multipart, no CDN integration, no thumbnail generation.
- **Hard delete.** Soft-delete only. There is no endpoint that physically removes a product document. If the team ever needs hard-purge for GDPR-style reasons, that lands as a separate PRD with the safety controls that change requires.
- **Inventory reservation / decrement on order placement.** Cart/checkout/inventory consistency is the orders PRD's problem.
- **Reviews, ratings, Q&A, related products, recommendations.**
- **Pricing tiers, discounts, coupons, dynamic pricing, tax computation.**
- **Search relevance ranking.** `q` is a regex substring match on `name` only — no Mongo text index, no fuzzy match, no scoring.
- **Audit log** of admin product actions. Same trail as users: `morgan` request log + Mongo `updatedAt`.
- **Rate limiting** on admin or public product endpoints.
- **Automated tests.**
- **Bulk operations** (bulk import, bulk publish, bulk price update).
- **Order integration.** No code in this PRD touches orders. Orders PRD will decide how to reference products and how to handle deleted-product references.

---

## Data model

### New collection: `products`

```js
// src/models/Product.js
const productSchema = new mongoose.Schema(
  {
    name:        { type: String, required: true, trim: true },
    slug:        { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    description: { type: String, default: '', trim: true },
    price:       { type: Number, required: true, min: 0 },
    currency:    { type: String, required: true, uppercase: true, trim: true, minlength: 3, maxlength: 3, default: 'USD' },
    stockQty:    { type: Number, required: true, min: 0, default: 0 },
    images:      { type: [String], default: [] },
    category:    { type: String, lowercase: true, trim: true, default: '', index: true },
    isActive:    { type: Boolean, default: false, index: true },
    deletedAt:   { type: Date, default: null, index: true },
  },
  { timestamps: true }
);
```

### Indexes

- `slug` — unique. Enforces global slug uniqueness across **all** products including deleted (Mongo's standard unique index does not partial-filter `null`s, and we explicitly want a deleted product to keep blocking re-use of its slug).
- `category` — non-unique. Cheap; supports admin filter and the future storefront browse-by-category page.
- `isActive` — non-unique. Public list always filters on this; cheap to maintain.
- `deletedAt` — non-unique. Public list always filters `deletedAt: null`; cheap to maintain.

If the catalog grows past ~10k products and the public list with `category` filter gets slow, add a compound `{ deletedAt: 1, isActive: 1, category: 1 }` later. Not preemptive.

### Lifecycle state matrix

Two independent flags produce four states. Both flips are admin-driven; the matrix is symmetric (no actor distinction like users' user-vs-admin self-delete-vs-suspend).

| `deletedAt` | `isActive` | State                  | Visible to public? | Visible to admin? |
|-------------|------------|------------------------|--------------------|-------------------|
| null        | true       | **live**               | yes                | yes               |
| null        | false      | **draft**              | no                 | yes               |
| set         | true       | **deleted-from-live**  | no                 | yes (with status filter) |
| set         | false      | **deleted-from-draft** | no                 | yes (with status filter) |

`isActive` survives delete. Restore clears `deletedAt` only — a product that was a draft when deleted comes back as a draft. Admin must explicitly flip `isActive` if they want a different post-restore state. This independence is deliberate, mirroring the suspend-vs-delete-separate-fields decision.

### Why soft delete + isActive (two independent flags)

Considered: hard delete with admin-confirmation friction. Rejected because:

1. **Hard delete is a one-way door.** Once gone, an admin's accidental click is unrecoverable. Soft-delete + restore is two-way reversible at the cost of one Date field and one filter clause.
2. **Order references survive delete.** Future order line-items can `populate` the product doc and get back the original record (filtered out of public listings, but readable via admin endpoints). The orders PRD can still snapshot product data for price-history / audit reasons, but order-read correctness no longer depends on snapshots existing.
3. **Consistent with the user-management pattern.** `../e-commerce-wiki/wiki/decisions/suspend-vs-delete-separate-fields.md` already established two independent lifecycle flags as a pattern. Reusing it here keeps the codebase legible — `setAccountStatus` is structurally analogous to the simpler single-collection `Product.findByIdAndUpdate(id, { $set: { deletedAt } })` here, but the mental model carries over.
4. **`isActive` and `deletedAt` answer different questions.** `isActive` = "is the admin ready to sell this?" `deletedAt` = "did the admin remove this from the catalog?" Collapsing them into one flag would conflate "draft pending publication" with "deleted, recoverable." Audit signal lost.

Cost: one extra Date field per product, one filter clause everywhere a list/get touches `Product`. Cheap.

### Why default `isActive: false`

Drafts by default. An admin who pastes a half-formed product into POST should not accidentally publish it. To go live, the admin makes a follow-up `PATCH { isActive: true }`. Mirrors the conservative defaults pattern (e.g., `isVerified: false` on new auth records).

### Slug rules

- Lowercase, trimmed, unique. The Mongoose `lowercase: true` + `unique: true` does the work.
- The PRD does **not** auto-generate slugs from `name`. Admin supplies the slug explicitly. Justification: name-to-slug normalization (whitespace, accents, locale, collisions) is a tar pit for an MVP. A future PRD can layer a slug-suggestion helper on top.
- Slug is editable via `PATCH`. Old URLs break — accepted; no redirect table for MVP.

---

## Flows

### Create

```
POST /api/v1/products       (admin)
    │
    ▼
  validate body via createProductSchema (joi)  → 400 with details on failure
    │
    ▼
  Product.create({ ...body })
    │
    ▼
  on Mongo duplicate-key error (slug)  → 409 "slug already exists"
    │
    ▼
  201 { ...newProduct }   (isActive defaults to false unless admin opts in)
```

### Update

```
PATCH /api/v1/products/:id   (admin)
    │
    ▼
  validate :id is a valid ObjectId      → 404 "product not found" if not
  validate body via updateProductSchema → 400 on failure
    │
    ▼
  Product.findByIdAndUpdate(id, { $set: body }, { new: true, runValidators: true })
    │
    ▼
  if not found → 404 "product not found"
  if duplicate-key (slug change collides) → 409 "slug already exists"
    │
    ▼
  200 { ...updatedProduct }
```

`isActive` is just another field in the update body. Flipping `false → true` is publish; `true → false` is unpublish.

### Soft delete

```
DELETE /api/v1/products/:id   (admin)
    │
    ▼
  validate :id  → 404 if invalid ObjectId
    │
    ▼
  Product.findOneAndUpdate(
    { _id: id, deletedAt: null },
    { $set: { deletedAt: new Date() } },
    { new: true }
  )
    │
    ▼
  if null (not found OR already deleted) → 404 "product not found"
    │
    ▼
  200 { message: "product deleted", id, deletedAt }
```

A re-DELETE on an already-deleted product returns 404, matching the user-management semantic ("not found" from the public surface's point of view, even if the row physically exists). Admin can verify state via `GET /products/:id` (admin sees deleted) or `GET /products?status=deleted`.

### Restore

```
POST /api/v1/products/:id/restore   (admin)
    │
    ▼
  validate :id  → 404 if invalid ObjectId
    │
    ▼
  Product.findOneAndUpdate(
    { _id: id, deletedAt: { $ne: null } },
    { $set: { deletedAt: null } },
    { new: true }
  )
    │
    ▼
  if null (not found OR not deleted) → 404 "product not deleted"
    │
    ▼
  200 { message: "product restored", product: { ... } }
```

The restored product retains its prior `isActive` value. If it was a draft when deleted, it comes back as a draft. The 200 response includes the full product so the admin sees the resulting state without a follow-up GET.

### Public list

```
GET /api/v1/products?page=&limit=&q=&category=    (anonymous-friendly, no auth middleware)
    │
    ▼ validate(listPublicProductsQuerySchema, 'query')
    ▼
  filter = { deletedAt: null, isActive: true }
  if q:        filter.name = new RegExp(escapeRegex(q), 'i')
  if category: filter.category = category
    ▼
  Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip((page-1)*limit).limit(limit).lean(),
    Product.countDocuments(filter)
  ])
    ▼
  200 { data, page, limit, total, totalPages }
```

No `status` query, no role inspection. Even an admin hitting this URL with their token sees only live products — to manage drafts/deleted they go to the admin URL.

### Admin list

```
GET /api/v1/admin/products?page=&limit=&q=&category=&status=    (admin)
    │
    ▼ requireAuth + requireRole('admin') + validate(listAdminProductsQuerySchema, 'query')
    ▼
  switch (query.status) {
    case 'live':    filter = { deletedAt: null, isActive: true };    break;
    case 'draft':   filter = { deletedAt: null, isActive: false };   break;
    case 'deleted': filter = { deletedAt: { $ne: null } };           break;
    case 'all':     filter = {};                                     break;
    default:        filter = { deletedAt: null };  // admin default: drafts + live, no trash
  }
  if q:        filter.name = new RegExp(escapeRegex(q), 'i')
  if category: filter.category = category
    ▼
  Promise.all([find().sort({createdAt:-1}).skip().limit().lean(), countDocuments()])
    ▼
  200 { data, page, limit, total, totalPages }
```

Admin default (no `status` provided) is "all non-deleted" — drafts + live, no trash. Trash is an explicit opt-in via `?status=deleted`. This differs from user-management's admin default of `'active'` deliberately: admins managing the catalog need to see drafts to publish them.

### Public getById

```
GET /api/v1/products/:id     (anonymous-friendly, no auth middleware)
    │
    ▼ validate :id is a valid ObjectId  → 404 "product not found" if not
    ▼
  Product.findOne({ _id: id, deletedAt: null, isActive: true }).lean()
    ▼
  if null → 404 "product not found"
       // 404 covers "doesn't exist", "deleted", and "draft" identically.
       // No status leak — a deleted or draft product is indistinguishable from a missing one.
    ▼
  200 { ...product }
```

### Admin getById

```
GET /api/v1/admin/products/:id     (admin)
    │
    ▼ requireAuth + requireRole('admin')
    ▼ validate :id  → 404 if invalid ObjectId
    ▼
  Product.findById(id).lean()
    ▼
  if null → 404 "product not found"
    ▼
  200 { ...product }   // any state — live, draft, deleted-from-live, deleted-from-draft
```

Useful for "review before restoring" and for any admin tooling that needs full visibility.

### Publish-vs-buyer-load race

Acknowledged: an admin can `PATCH isActive=false` (or `DELETE`) on a product currently being viewed by a shopper. The shopper's already-loaded page is stale; their next request returns 404. No locking, no soft-window — accepted MVP behavior.

---

## API surface (final)

```
PUBLIC (no middleware beyond joi validation; anonymous-friendly; live products only)
  GET    /api/v1/products                  ← NEW   list, paginated; filter: q, category. Always { deletedAt:null, isActive:true }
  GET    /api/v1/products/:id              ← NEW   getById; 404 if not live (covers missing, draft, or deleted indistinguishably)

ADMIN (requireAuth + requireRole('admin'); full visibility)
  GET    /api/v1/admin/products            ← NEW   list across lifecycle; ?status=live|draft|deleted|all (default: all non-deleted)
  GET    /api/v1/admin/products/:id        ← NEW   any product, any state
  POST   /api/v1/admin/products            ← NEW   create; isActive defaults to false
  PATCH  /api/v1/admin/products/:id        ← NEW   partial update; can flip isActive
  DELETE /api/v1/admin/products/:id        ← NEW   soft delete (sets deletedAt); 200 with id+deletedAt
  POST   /api/v1/admin/products/:id/restore ← NEW  clears deletedAt; 200 with full product
```

### Request / response shapes

**`POST /admin/products`**
```json
// request
{
  "name": "Winter Jacket",
  "slug": "winter-jacket-2026",
  "description": "Insulated, waterproof, blah",
  "price": 199.99,
  "currency": "USD",
  "stockQty": 50,
  "images": ["https://cdn.example.com/winter-jacket-front.jpg"],
  "category": "outerwear",
  "isActive": false
}

// response 201 — same shape with _id, createdAt, updatedAt, deletedAt:null
```

**`PATCH /admin/products/:id`** — partial; any subset of the create fields
```json
// request
{ "isActive": true, "stockQty": 47 }

// response 200 — full updated product
```

**`DELETE /admin/products/:id`** — empty body
```json
// response 200
{ "message": "product deleted", "id": "...", "deletedAt": "2026-05-07T..." }
```

**`POST /admin/products/:id/restore`** — empty body
```json
// response 200 — full product so admin sees post-restore state (e.g., still a draft)
{ "message": "product restored", "product": { "_id": "...", "deletedAt": null, "isActive": false, ...rest } }
```

**`GET /products`** and **`GET /admin/products`** — see flows above. Envelope:
```json
{
  "data": [ { ...product }, ... ],
  "page": 1,
  "limit": 20,
  "total": 137,
  "totalPages": 7
}
```

**`GET /products/:id`** — public; returns the product object directly (no envelope). 404 if not found, deleted, or draft — all indistinguishable.

**`GET /admin/products/:id`** — admin; returns the product object directly regardless of lifecycle state. 404 only if the document does not exist.

---

## Authorization & visibility guards

The split-URL design means authorization is decided by **route mounting**, not by middleware introspection. Each row below names exactly one middleware chain.

| Endpoint                                | Middleware chain                                       | Visibility |
|-----------------------------------------|--------------------------------------------------------|----|
| `GET /api/v1/products`                  | `validate(listPublicProductsQuerySchema, 'query')`     | live only (`deletedAt:null AND isActive:true`); fixed in service, no query override |
| `GET /api/v1/products/:id`              | none                                                   | live only — 404 covers missing/deleted/draft identically (no existence leak) |
| `GET /api/v1/admin/products`            | `requireAuth` + `requireRole('admin')` + `validate(listAdminProductsQuerySchema, 'query')` | full lifecycle; `?status=` slices |
| `GET /api/v1/admin/products/:id`        | `requireAuth` + `requireRole('admin')`                 | any state |
| `POST /api/v1/admin/products`           | `requireAuth` + `requireRole('admin')` + `validate(createProductSchema)` | n/a |
| `PATCH /api/v1/admin/products/:id`      | `requireAuth` + `requireRole('admin')` + `validate(updateProductSchema)` | admin can patch any product including deleted |
| `DELETE /api/v1/admin/products/:id`     | `requireAuth` + `requireRole('admin')`                 | 404 if already deleted |
| `POST /api/v1/admin/products/:id/restore` | `requireAuth` + `requireRole('admin')`               | 404 if not currently deleted |

No new auth middleware. No JWT inspection on public routes. The existing `requireAuth` (`src/middleware/requireAuth.js`) and `requireRole` (`src/middleware/requireRole.js`) cover every authed route unchanged.

### Why no `optionalAuth` (considered, rejected)

An earlier draft used a single `/api/v1/products` URL with a permissive `optionalAuth` middleware that inspected the JWT-if-present and shaped the response by role. Rejected because:

1. **Two responsibilities on one URL** — the same endpoint had to be cached-friendly for shoppers and dynamic for admins. With the split, the public URL is naturally cacheable (no token-dependent variation, no `Vary: Authorization` complexity).
2. **Silent token failures hurt debuggability** — `optionalAuth` had to swallow bad/expired tokens to keep the storefront open. An admin debugging "why isn't my admin token working?" got no signal. Splitting moves admin operations behind `requireAuth`, which gives a loud 401/403 on token problems.
3. **Service complexity** — list/getById each needed a role-aware filter branch. With the split, each method does one thing: `listProducts` (always live) and `listAllProducts` (full lifecycle).
4. **No new shared helper needed** — without `optionalAuth`, there's no second consumer of JWT verify + user-load logic, so the `_resolveTokenUser` extraction stops earning its keep. `requireAuth` stays as it is today.

The trade-off: an admin who wants to verify "what shoppers see right now" hits `/api/v1/products` (no token), not `/api/v1/admin/products?status=live`. Slightly less symmetric, materially simpler.

---

## Validation

New joi schemas in `src/middleware/validators/product.validators.js`:

```js
import Joi from 'joi';

const URL_REGEX = /^https?:\/\/.+/i;

export const createProductSchema = Joi.object({
  name:        Joi.string().trim().min(1).max(200).required(),
  slug:        Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120).required(),
  description: Joi.string().trim().allow('').max(5000).default(''),
  price:       Joi.number().min(0).precision(2).required(),
  currency:    Joi.string().trim().uppercase().length(3).default('USD'),
  stockQty:    Joi.number().integer().min(0).default(0),
  images:      Joi.array().items(Joi.string().trim().pattern(URL_REGEX)).max(20).default([]),
  category:    Joi.string().trim().lowercase().max(60).allow('').default(''),
  isActive:    Joi.boolean().default(false),
}).unknown(false);

export const updateProductSchema = Joi.object({
  name:        Joi.string().trim().min(1).max(200),
  slug:        Joi.string().trim().lowercase().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(120),
  description: Joi.string().trim().allow('').max(5000),
  price:       Joi.number().min(0).precision(2),
  currency:    Joi.string().trim().uppercase().length(3),
  stockQty:    Joi.number().integer().min(0),
  images:      Joi.array().items(Joi.string().trim().pattern(URL_REGEX)).max(20),
  category:    Joi.string().trim().lowercase().max(60).allow(''),
  isActive:    Joi.boolean(),
}).min(1).unknown(false);   // require at least one field

export const listPublicProductsQuerySchema = Joi.object({
  page:     Joi.number().integer().min(1).default(1),
  limit:    Joi.number().integer().min(1).max(100).default(20),
  q:        Joi.string().trim().allow(''),
  category: Joi.string().trim().lowercase(),
}).unknown(false);

export const listAdminProductsQuerySchema = listPublicProductsQuerySchema.append({
  status:   Joi.string().valid('live', 'draft', 'deleted', 'all'),
});
```

The admin schema is built from the public one with `.append()` so the shared fields cannot drift. Public callers passing `?status=` will get a joi 400 because `unknown(false)` rejects unrecognized keys — which is correct behavior (no silent ignore).

`validate(schema, target)` middleware factory at `src/middleware/validate.js` already supports `target='query'` and `target='body'`. Wire as:

- `GET    /products`                    — `validate(listPublicProductsQuerySchema, 'query')`
- `GET    /admin/products`              — `validate(listAdminProductsQuerySchema, 'query')`
- `POST   /admin/products`              — `validate(createProductSchema)`
- `PATCH  /admin/products/:id`          — `validate(updateProductSchema)`
- `POST   /admin/products/:id/restore`  — no body schema; `:id` validated in service via `mongoose.isValidObjectId`

---

## File-by-file plan

```
src/
├── models/
│   └── Product.js                       NEW   schema per §Data model
├── routes/
│   ├── index.js                         EDIT  mount adminProductRouter at /admin/products
│   ├── product.routes.js                EDIT  PUBLIC ONLY now: GET / and GET /:id, no auth middleware,
│   │                                          validate(listPublicProductsQuerySchema, 'query') on list
│   └── adminProduct.routes.js           NEW   ADMIN ONLY: list / getById / create / update / remove / restore.
│                                              Router-level: requireAuth + requireRole('admin') applied via router.use(...)
│                                              so every route inherits the gate.
├── controllers/
│   └── product.controller.js            EDIT  expose:
│                                                publicList, publicGetById  (used by product.routes.js)
│                                                list, getById, create, update, remove, restore  (used by adminProduct.routes.js)
├── services/
│   └── product.service.js               REWRITE  expose:
│                                                listPublic({page,limit,q,category})
│                                                listAll({page,limit,q,category,status})
│                                                getPublicById(id)
│                                                getAnyById(id)            // admin
│                                                create(payload)
│                                                update(id, payload)
│                                                remove(id)                // soft-delete
│                                                restore(id)
├── middleware/
│   └── validators/
│       └── product.validators.js        NEW   createProductSchema, updateProductSchema,
│                                              listPublicProductsQuerySchema, listAdminProductsQuerySchema
└── utils/
    └── escapeRegex.js                   NEW   extract from user.service.js's inline regex-escape. Default export:
                                              `escapeRegex(input: string): string`. user.service.js migrates to import
                                              from here in the same commit.

scripts/
└── products.http                        NEW   smoke probes (split by URL family):
                                                public:  GET /products (live only),
                                                         GET /products/:id (404 covers missing/draft/deleted),
                                                         GET /products?status=draft → 400 (unknown key),
                                                admin:   create + publish lifecycle,
                                                         GET /admin/products (?status=live|draft|deleted|all),
                                                         GET /admin/products/:id (any state),
                                                         update slug collision (409),
                                                         delete (200) + re-delete (404),
                                                         restore (200) + re-restore (404),
                                                         deleted-while-draft round-trip preserves isActive=false,
                                                         validation failures (price < 0, bad slug, bad URL),
                                                         non-admin token to /admin/products/* → 403,
                                                         no token to /admin/products/* → 401
```

**Reuse without modification:**

- `requireAuth` — `src/middleware/requireAuth.js` (mounted at the admin router level)
- `requireRole('admin')` — `src/middleware/requireRole.js` (mounted at the admin router level)
- `validate(schema, target)` — `src/middleware/validate.js`
- `ApiError` — `src/utils/ApiError.js`
- `asyncHandler` — `src/middleware/asyncHandler.js`
- `mongoose.isValidObjectId` ID-guard — pattern at `src/services/user.service.js:41-43`
- Pagination shape (`Promise.all([find().skip().limit().lean(), countDocuments()])` returning `{data, page, limit, total, totalPages}`) — pattern at `src/services/user.service.js:53-87`

No new auth middleware. No new dependencies. No env additions.

---

## Failure modes

Without automated tests, every failure mode below relies on the runtime error handler. Manual verification is the only safety net.

| Codepath               | Realistic failure                                       | Handler?                          | User sees?                       |
|------------------------|---------------------------------------------------------|-----------------------------------|----------------------------------|
| `createProduct`        | duplicate slug                                          | ✓ catch Mongo `E11000`            | 409 "slug already exists"        |
| `createProduct`        | price < 0, bad URL in images, slug not kebab-case       | ✓ joi                             | 400 with details array           |
| `createProduct`        | non-admin attempts                                      | ✓ requireRole gate                | 403                              |
| `createProduct`        | unauthenticated attempts                                | ✓ requireAuth                     | 401                              |
| `updateProduct`        | empty body                                              | ✓ joi `.min(1)` on update schema  | 400 "at least one field required"|
| `updateProduct`        | slug change collides with another product               | ✓ catch `E11000`                  | 409 "slug already exists"        |
| `updateProduct`        | id is not a valid ObjectId                              | ✓ ID guard                        | 404 "product not found"          |
| `updateProduct`        | id is valid but no matching doc                         | ✓ findByIdAndUpdate returns null  | 404 "product not found"          |
| `deleteProduct`        | id not valid / not found / already deleted              | ✓                                 | 404 "product not found"          |
| `deleteProduct`        | product currently in a user's cart (future)             | ✓ document survives soft-delete   | shopper sees 404 on public list/getById; orders PRD can still resolve the doc via admin-equivalent service call |
| `restoreProduct`       | id not valid / not found / not currently deleted        | ✓                                 | 404 "product not deleted"        |
| `restoreProduct`       | product was a draft when deleted                        | ✓ by design — isActive preserved through restore | 200; admin sees product still has `isActive: false` and can decide to publish |
| `listPublic`           | caller passes `?status=draft` hoping to see drafts      | ✓ joi rejects unknown keys (`unknown(false)`) | 400 "status is not allowed"  |
| `listPublic` / `listAll` | regex injection via `q`                               | ✓ escapeRegex on `q` before RegExp construction | safe                |
| `listPublic` / `listAll` | malformed query (`page=abc`, `limit=9999`, `status=foo`) | ✓ joi                            | 400 with details                 |
| `getPublicById`        | valid id, draft or deleted product                      | ✓ filter excludes both — `findOne({_id, deletedAt:null, isActive:true})` returns null | 404 "product not found" — covers missing/deleted/draft identically (no existence leak) |
| Admin routes (any)     | unauthenticated request                                 | ✓ requireAuth                     | 401 "authentication required"   |
| Admin routes (any)     | regular-user token                                      | ✓ requireRole('admin')            | 403 "admin role required"       |
| Admin routes (any)     | suspended-user token (valid JWT, suspendedAt set)       | ✓ requireAuth                     | 403 "account suspended"         |

**Note on the suspended-user-browsing-storefront decision:** a suspended user keeps anonymous read access to the public catalog because the public URL has no auth middleware at all — every shopper, suspended or not, hits the same anonymous-friendly endpoint. They cannot log in, cannot use any admin URL, cannot place orders, cannot see drafts. Acceptable: suspension pauses the *account*, not the shopper's eyeballs.

---

## Open risks (acknowledged, not solved)

1. **No automated tests** — same risk as auth/users. Catalog reads are public, so a regression in the public route (e.g., the joi validator accidentally requires a body) takes down the storefront. Highest-priority follow-up before production. Per `wiki/decisions/no-automated-tests-mvp`.
2. **Slug uniqueness blocks re-using a deleted product's slug.** Because the unique index on `slug` covers all documents (deleted included), an admin who soft-deletes "winter-jacket" cannot create a new "winter-jacket" later — they must restore the old one or pick a new slug. Trade-off accepted: the alternative (partial unique index `{ slug: 1 } where deletedAt: null`) means a restore can collide with a freshly-created product, and we'd need conflict resolution logic at restore time. Slug-blocking is the simpler invariant.
3. **`price` stored as a JS `Number` (float).** Floating-point dollars-and-cents is a minor risk for arithmetic at order time (e.g., `0.1 + 0.2`). Acceptable for MVP since orders aren't computing totals yet; revisit by switching to integer minor units (`priceCents`) when order math lands.
4. **No image validation beyond URL regex.** A malformed but `https://`-prefixed URL passes joi. No HEAD check, no MIME check, no size cap, no hotlinking allowlist. A malicious admin (compromised token) could embed tracking pixels or huge images that browsers fetch. Mitigation: trust the admin role boundary.
5. **Slug edits orphan old URLs.** No redirect table. Acceptable at MVP scale.
6. **`q` substring search performance** — case-insensitive regex on `name` does a collection scan. Fine for MVP; revisit with a Mongo text index when product count crosses ~10k.
7. **No rate limiting** on public list/get endpoints. A scraper can drain the catalog. Acceptable until rate limiting lands as cross-cutting middleware.
8. **`category` as free-text** drifts without a controlled vocabulary. Two admins can create `"shoes"` and `"footwear"` and split the same logical category. Revisit when the storefront actually needs a category index page.
9. **No confirmation step on `DELETE`.** A misclick still soft-deletes — but the product is fully recoverable via restore. The blast radius dropped to "shopper sees 404 until admin restores," which is acceptable without a confirm token.
10. **Restored-from-draft surprise.** A product deleted while in `isActive=false` comes back as a draft. The 200 response includes the full product so the admin sees the resulting `isActive: false`, but a hurried admin might expect "restore = back on the shelf" and miss the draft state. Mitigated by surfacing state in the response.
11. **URL-family asymmetry for admins.** An admin who wants to "see what shoppers see right now" has to hit `/api/v1/products` (no token) instead of `/api/v1/admin/products?status=live`. The two return the same data when filters match, but they're literally different URLs. A diligent admin uses the public URL for verification; a sloppy one might think `?status=live` is sufficient and miss public-only response shaping in any future change.

---

## Verification (manual, after implementation)

Prereqs: `docker compose up -d` (Mongo replica set), `.env` configured, `npm run dev` running, an admin bootstrapped via `node scripts/create-admin.js`, and one regular verified user available.

Capture `@adminToken` and `@userToken` via `POST /auth/login`. Capture an arbitrary bad token (`@badToken = "Bearer notajwt"`).

```
1. Schema bring-up
   POST /admin/products  with full valid payload (admin)         → 201; default isActive=false, deletedAt=null applied
   mongosh: db.products.findOne()                                 → confirm slug unique-indexed,
                                                                     timestamps populated, defaults present

2. Slug uniqueness
   POST /admin/products  with same slug (admin)                  → 409 "slug already exists"
   PATCH /admin/products/:idA  { slug: "<slug-of-B>" }           → 409 "slug already exists"

3. Validation (admin writes)
   POST /admin/products  { name: "x", slug: "Bad Slug" }         → 400 (slug must be kebab-case)
   POST /admin/products  { ..., price: -1 }                      → 400
   POST /admin/products  { ..., images: ["not-a-url"] }          → 400
   POST /admin/products  { ..., currency: "usdollar" }           → 400 (length 3)
   PATCH /admin/products/:id  { }                                → 400 "at least one field required"

4. Validation (list queries)
   GET  /products?page=abc                                       → 400
   GET  /products?limit=9999                                     → 400 (max 100)
   GET  /products?status=draft                                   → 400 "status is not allowed" (public schema rejects unknown key)
   GET  /admin/products?status=foo                               → 400 (joi enum)
   GET  /admin/products?page=abc                                 → 400

5. Authorization on admin URL family
   POST   /admin/products (no token)                             → 401 "authentication required"
   POST   /admin/products (@userToken)                           → 403 "admin role required"
   PATCH  /admin/products/:id (@userToken)                       → 403
   DELETE /admin/products/:id (@userToken)                       → 403
   GET    /admin/products (@userToken)                           → 403  (regular user cannot list admin view)
   GET    /admin/products (no token)                             → 401
   POST   /admin/products/:id/restore (no token)                 → 401

6. Public list (anonymous-only behavior)
   (state: admin has created A=live published, B=draft)
   GET /products (no token)                                      → A only; B hidden
   GET /products (@userToken)                                    → A only (token has no effect here — no auth middleware)
   GET /products (@adminToken)                                   → A only (admin token has no effect on public URL — by design)
   GET /products (@badToken)                                     → A only (no middleware, token never inspected)
   GET /products?q=<partial-name-of-A>                           → A
   GET /products?q=.*+                                           → regex special chars escaped, no error, no inflated match
   GET /products?category=<A's category>                         → A only

7. Admin list (full lifecycle)
   GET /admin/products (admin, no status)                        → A and B both visible (admin default = all non-deleted)
   GET /admin/products?status=live (admin)                       → only A
   GET /admin/products?status=draft (admin)                      → only B
   GET /admin/products?status=deleted (admin)                    → empty (initially)
   GET /admin/products?status=all (admin)                        → A and B (and any deleted, once present)

8. Public getById (existence cloaking)
   GET /products/:idA (no token)                                 → 200 A
   GET /products/:idB (no token)                                 → 404 "product not found"  (draft hidden)
   GET /products/:idB (@adminToken)                              → 404 (admin token does not unlock public URL)
   GET /products/<not-an-objectid> (no token)                    → 404
   GET /products/<valid-objectid-but-no-doc> (no token)          → 404

9. Admin getById (full visibility)
   GET /admin/products/:idA (admin)                              → 200 A
   GET /admin/products/:idB (admin)                              → 200 B (admin sees draft)
   GET /admin/products/<bad-id> (admin)                          → 404
   GET /admin/products/:idA (no token)                           → 401
   GET /admin/products/:idA (@userToken)                         → 403

10. Publish / unpublish lifecycle
    PATCH /admin/products/:idB  { isActive: true }   (admin)     → 200; B now live
    GET /products (no token)                                     → A and B both visible
    PATCH /admin/products/:idB  { isActive: false }  (admin)     → 200; B back to draft
    GET /products (no token)                                     → A only

11. Update fields
    PATCH /admin/products/:idA  { price: 249.50, stockQty: 0 }   → 200 with updates
    PATCH /admin/products/:idA  { images: ["https://example.com/a.png", "https://example.com/b.png"] }  → 200
    PATCH /admin/products/:idA  { slug: "new-slug" }             → 200

12. Soft delete + restore
    DELETE /admin/products/:idA (admin)                          → 200 { message:"product deleted", id, deletedAt }
    GET    /products/:idA (no token)                             → 404 (deleted hidden from public)
    GET    /admin/products/:idA (admin)                          → 200 with deletedAt set (admin sees deleted)
    GET    /admin/products?status=deleted (admin)                → contains A
    DELETE /admin/products/:idA (admin, again)                   → 404 "product not found"
    POST   /admin/products/:idA/restore (admin)                  → 200 { message:"product restored", product:{ deletedAt:null, isActive:true } }
    GET    /products (no token)                                  → A back in the public list
    POST   /admin/products/:idA/restore (admin, again)           → 404 "product not deleted"

    Deleted-from-draft round-trip:
    PATCH  /admin/products/:idB { isActive: false } (admin)      → 200; B is a draft
    DELETE /admin/products/:idB (admin)                          → 200; B deleted while a draft
    POST   /admin/products/:idB/restore (admin)                  → 200 with isActive:false PRESERVED (still a draft)
    GET    /products (no token)                                  → does NOT contain B (still a draft)
    PATCH  /admin/products/:idB { isActive: true } (admin)       → 200; B now live
    GET    /products (no token)                                  → contains B

    Slug-uniqueness across deleted:
    POST   /admin/products { slug: "<idA's slug>" } (admin) while idA is deleted → 409 "slug already exists"
                                                                  (deleted products keep their slug per Open Risk #2)

    Patch on a deleted product (allowed by design — admin can fix typos before restoring):
    DELETE /admin/products/:idC (admin)                          → 200; idC deleted
    PATCH  /admin/products/:idC  { description: "fixed typo" } (admin) → 200 with updated description, deletedAt still set
    GET    /admin/products/:idC (admin)                          → 200 with new description AND deletedAt set

13. Pagination envelope
    Seed ~25 products, half live.
    GET /products?page=1&limit=10                                → 10 items, totalPages reflects live-only count
    GET /admin/products?page=1&limit=10 (admin)                  → 10 items, totalPages reflects all-non-deleted count

14. Suspended-user storefront access
    Suspend @userToken's user via admin endpoint.
    GET  /products (with old @userToken)                         → 200 (no auth middleware on public URL — token irrelevant)
    GET  /admin/products (with old @userToken)                   → 403 "account suspended" (requireAuth surfaces the state)
    POST /auth/login (suspended user)                            → 403 "account suspended"  (regression check on auth)

15. Existing flows untouched
    POST /auth/register                                          → 201 (regression check)
    GET  /users/me (@userToken on still-active user)             → 200 (regression check)
```

---

## Next steps

1. Eng review (`/plan-eng-review`) of this PRD.
2. On clean review, implement in a follow-up session.
3. Append smoke commands to `scripts/products.http`.
4. End-of-session capture promotes:
   - `wiki/decisions/products-soft-delete-and-isactive.md` — two independent lifecycle flags (`deletedAt`, `isActive`), the four-state matrix, slug-uniqueness-blocks-restored-collisions trade-off, restore preserves `isActive`
   - `wiki/decisions/admin-namespace-split.md` — `/api/v1/products` (public, no auth) vs `/api/v1/admin/products` (admin, full lifecycle). Why split won over a role-aware single endpoint: cacheability, loud auth errors on admin URLs, no `optionalAuth` complexity, simpler service signatures
   - `wiki/flows/products.md` — admin lifecycle (create draft → publish → unpublish → delete → restore) and the public-vs-admin URL split

---

## GSTACK REVIEW REPORT

| Review        | Trigger              | Why                                      | Runs | Status              | Findings                                 |
|---------------|----------------------|------------------------------------------|------|---------------------|-------------------------------------------|
| CEO Review    | `/plan-ceo-review`   | Scope & strategy                         | 0    | —                   | not run                                   |
| Eng Review    | `/plan-eng-review`   | Architecture & tests (required)          | 2    | DONE                | Pass 1: 4 fixes applied (soft-delete, helper extraction). Pass 2 (post option-B refactor): 1 doc fix + 1 probe gap closed. 0 critical gaps; test coverage 30/31 branches probed (97%), 1 inherited gap (expired JWT, not a regression). |
| Codex Review  | `/codex review`      | Independent 2nd opinion                  | 0    | —                   | not run                                   |
| Design Review | `/plan-design-review`| UI/UX gaps                               | 0    | —                   | n/a (backend-only)                        |
| Outside Voice | optional             | Cross-model challenge                    | 0    | —                   | skipped (auto mode)                       |

**APPLIED — PASS 1 (initial review):**
- **A1** *(architectural)* — switched from hard-delete to soft-delete + `deletedAt` with reversible `POST /admin/products/:id/restore`. Order references now survive delete. Two independent lifecycle flags compose into a four-state matrix (live/draft/deleted-from-live/deleted-from-draft). `isActive` is preserved through restore.
- **A2** *(architectural)* — **split URL families** instead of a single role-aware endpoint. Public reads at `/api/v1/products` (no auth middleware, anonymous-friendly, live products only). All admin operations under `/api/v1/admin/products` (`requireAuth + requireRole('admin')`, full lifecycle). Replaces the earlier `optionalAuth` + `_resolveTokenUser` design. Benefits: public URL is cacheable; admin URLs give loud 401/403 on token problems; service signatures are single-purpose; no new middleware. Trade-off documented in Open Risk #11 (admin must use the public URL to verify "what shoppers see").
- **C1** *(code quality)* — `escapeRegex` extracted from `user.service.js` into `src/utils/escapeRegex.js`; `user.service.js` migrates in the same commit.
- **V1** *(validation)* — joi list schemas split: `listPublicProductsQuerySchema` (no `status` field, `unknown(false)` rejects it loudly) and `listAdminProductsQuerySchema` built via `.append({ status })` so the shared fields cannot drift.

**APPLIED — PASS 2 (re-review of post-refactor PRD):**
- **D1** *(doc bug)* — `Where this PRD lives` section had stale "hard-delete-with-isActive" text from before the soft-delete switch. Updated to point at the actual wiki targets in §Next steps.
- **T2** *(test coverage)* — added a `PATCH /admin/products/:idC` probe to §Verification step 12 to cover the explicitly-allowed "patch a soft-deleted product" path (admin fixing a typo before restoring). Brings code-path coverage from 30/31 to 31/31.

**SUPERSEDED (earlier draft, no longer in PRD):**
- ~~`src/middleware/_resolveTokenUser.js`~~ — not needed; only `requireAuth` consumes JWT-verify + user-load now.
- ~~`src/middleware/optionalAuth.js`~~ — not needed; public URL has no auth middleware at all.
- ~~`requireAuth.js` REFACTOR~~ — stays as it is today.

**DEFERRED:**
- **P1** *(performance, preemptive)* — compound index `{ deletedAt: 1, isActive: 1, createdAt: -1 }` for the public list happy path. PRD already gates this on a 10k-product threshold; not adding for MVP.
- **A3** *(scope)* — currency joi check is length-3-uppercase only (no enum). Typos like `"USS"` or fictional currencies pass. Trade-off: trust the admin role boundary, same as Open Risk #4 (image URL validation).
- **A4** *(scope)* — `category` as free-text without controlled vocabulary; documented in Open Risk #8.

**TEST COVERAGE GAPS (acknowledged):**
- `'expired'` JWT branch on admin URLs — manual probing impractical with 7d TTL. Inherited from existing `requireAuth` behavior; not a regression. Revisit when refresh tokens land.

**UNRESOLVED:** 0
**VERDICT:** ENG REVIEW DONE (2 passes) — ready to implement. Schema, lifecycle, URL split, validation, and code-path coverage all locked. Only one inherited test gap remains (expired-JWT, pre-existing in requireAuth) and it does not block.
