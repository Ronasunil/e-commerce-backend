# PRD — Cart Feature

> Status: draft, eng-reviewed (clean). Owner: tech@tghtech.com. Date: 2026-05-12. Branch: `main`.

## Context

`auth`, `user-management`, and `products` are shipped (see `../e-commerce-wiki/wiki/flows/`). An earlier cart scaffolding was deleted in this session because it had no wiki coverage. This PRD introduces a fresh cart feature so an authenticated user can hold products before a future orders/checkout flow ships.

Cart in this PRD is **a per-user holding area only** — no checkout, no payment, no order placement. That stays for the future orders PRD (anticipated in `../e-commerce-wiki/raw/features/2026-05-07-products.md`).

### Decisions locked in (this PRD)

- **Singleton cart per user.** One `Cart` document keyed by `authId` (unique index). Each user has exactly one cart row; cart lines live in an `items: []` sub-array on that single doc.
- **Live pricing.** Cart stores only `{ productId, quantity, addedAt }` per line. Product fields are populated on read; subtotal computed at read time. Snapshotting deferred to orders PRD (matches `../e-commerce-wiki/wiki/decisions/products-soft-delete-and-isactive.md`).
- **Reject on add when stock insufficient.** `stockQty < (existing + requested)` → `409 "insufficient stock"`. Cart never holds an unfulfillable line.
- **Authed-only.** No anonymous cart, no `guestId` cookie, no merge-on-login. All routes behind `requireAuth`.
- **Currency-locked-by-first-item.** First add captures `currency` onto the cart; subsequent adds in a different currency → `409 "mixed-currency cart not supported"`. Currency clears whenever items go to 0.
- **Cart stock check is advisory UX, not a reservation.** Cart does NOT reserve product stock. Two users racing on the last unit BOTH succeed at cart layer. Actual stock decrement and reservation are the orders PRD's job.
- **Atomic upsert on read.** `GET /cart` uses `Cart.findOneAndUpdate(..., { upsert: true, new: true })` — no race window where parallel GETs hit the unique-index 500.
- **Populate allowlist.** `GET /cart` populates only `name slug price currency stockQty isActive deletedAt images` from `Product` — never the full doc.
- **`404 "item not in cart"`** is the response shape for both `PATCH /cart/items/:productId` and `DELETE /cart/items/:productId` when the productId is not in the cart. Matches existing `product.service.js` 404 pattern.
- **No transactions.** All cart writes touch a single collection. The product-read-then-cart-write window is the "advisory stock check" contract above.
- **Atomic write operators throughout.** `addItem` uses two-pass `findOneAndUpdate` with `$inc`/`$push`; `updateItemQuantity` uses positional `$set`; `removeItem` uses an aggregation-pipeline update; `clearCart` uses `$set`. No read-mutate-save sequences — parallel writes from the same user cannot lose increments.
- **PATCH allowed on soft-deleted/inactive product lines.** `updateItemQuantity` loads the product without the active+!deleted filter, so users can reduce or remove the qty of any line in their cart. Hard-deleted products still return 404.
- **No automated tests** — `../e-commerce-wiki/wiki/decisions/no-automated-tests-mvp.md`. Manual verification via `scripts/cart.http` (18 probes).

### Where this PRD lives

- Repo: `docs/prd-cart.md` (this file)
- Plan file: `/home/rona/.claude/plans/iridescent-wishing-tome.md` (eng-reviewed clean; 4 issues found and resolved)
- **Wiki:** not written mid-session per `../e-commerce-wiki/CLAUDE.md`. End-of-session capture promotes the cart flow and any re-litigated decisions into the wiki.

---

## Goals

1. An authenticated user can add a product to their cart, see what's in it, change quantities, remove individual lines, and clear the cart.
2. Cart enforces sane invariants at write time: one currency per cart, no quantity exceeding `stockQty`, no items < 1, no lines for inactive/soft-deleted products.
3. Cart survives a product later being soft-deleted or marked inactive — the line stays, but the cart response flags `hasUnavailableItems: true` and excludes that line from `subtotal`.
4. Suspended or soft-deleted users cannot touch the cart surface — `requireAuth` returns 403/401 before the controller runs.
5. Cart read is one MongoDB round-trip plus one populate batch; payload is bounded by an explicit field allowlist.

## Non-goals (NOT in scope)

- **Checkout / order placement.** Orders PRD's problem.
- **Stock reservation / decrement on add.** Orders PRD owns the reservation contract.
- **Anonymous carts and merge-on-login.** Cart is always authed.
- **Wishlist / save-for-later.** Singleton cart only.
- **Cart expiry / abandonment cleanup.** No TTL, no background job.
- **Discount codes / promo logic.**
- **Per-line price snapshots.** Snapshot belongs at order-creation time, not add-to-cart.
- **Admin endpoints** (`/admin/cart`). No current operational need.
- **Rate limiting** on cart endpoints. Acknowledged gap — revisit if abuse appears.
- **Multi-currency carts.** Locked to single-currency by design.
- **Automated tests.** Manual smoke only.

---

## Data model

```
cart (collection)
  _id                                         ObjectId
  authId       UNIQUE — FK → auth._id        ObjectId
  items        sub-array
    - productId                              ObjectId (ref Product)
    - quantity                               Number, min 1
    - addedAt                                Date
  currency     captured from first item       String | null (3-letter)
  createdAt, updatedAt                       Date
```

**Indexes:** `{ authId: 1 }` unique.

**Why `authId` as FK (not `userId`):** `requireAuth` already loads via `authId` and exposes `req.authId`. `User.authId` is the natural identity FK across the codebase (see `../e-commerce-wiki/wiki/decisions/auth-users-collection-split.md`). Saves a `User.findOne` per cart op.

**Why `currency` lives on the cart, not per-item:** mixed-currency carts are a checkout footgun. First item locks the cart; subsequent adds in a different currency → 409. Currency clears when items go to 0.

**Invariant: `items.length === 0 ⇒ currency === null`.** Enforced by BOTH `DELETE /cart` AND `DELETE /cart/items/:productId` when it pulls the last line.

**No soft-delete on cart.** Cart is ephemeral. `DELETE /cart` clears items, it does not soft-delete the document.

---

## API surface

All under `/api/v1/cart`. All require `requireAuth`. No admin endpoints.

| Method | Path | Behavior |
|---|---|---|
| `GET`    | `/cart`                    | Get current user's cart (atomic upsert). Populates allowlisted product fields. Returns `{ cart, subtotal, itemCount, hasUnavailableItems }`. |
| `POST`   | `/cart/items`              | Add an item. Body `{ productId, quantity = 1 }`. Increments line if product already in cart. |
| `PATCH`  | `/cart/items/:productId`   | Set exact quantity (min 1). To remove, use DELETE. |
| `DELETE` | `/cart/items/:productId`   | Remove a single line. Clears `currency` if the cart becomes empty. |
| `DELETE` | `/cart`                    | Clear all items and currency. |

Response shape matches existing controllers — plain JSON, no envelope. `res.status(201).json(cart)` on add, `res.json(...)` on read/update, `res.json({ message: 'cart cleared' })` on delete-all.

---

## Service layer (`src/services/cart.service.js`)

```js
export const cartService = {
  async getMyCart(authId)                                   // atomic upsert + populate(allowlist)
  async addItem(authId, { productId, quantity })            // upsert line, stock + currency checks
  async updateItemQuantity(authId, productId, quantity)     // 404 if line missing; absolute qty
  async removeItem(authId, productId)                       // 404 if line missing; clear currency if empty
  async clearCart(authId)                                   // items: [], currency: null
};
```

### `getMyCart` (atomic upsert)

```js
const cart = await Cart.findOneAndUpdate(
  { authId },
  { $setOnInsert: { authId, items: [], currency: null } },
  { upsert: true, new: true }
).populate('items.productId', 'name slug price currency stockQty isActive deletedAt images');
```

Then compute the response shape:
- `subtotal`: sum of `line.quantity * line.productId.price` ONLY across lines where `line.productId.isActive === true && line.productId.deletedAt === null`.
- `itemCount`: total quantity across ALL lines (available + unavailable).
- `hasUnavailableItems`: boolean, true if any populated product is inactive or soft-deleted.

### `addItem` algorithm (two-pass atomic)

1. `assertObjectId(productId, 'product')` and `loadActiveProduct` — `404 "product not found"` if missing/inactive/soft-deleted.
2. **Pass 1 — atomic `$inc` on existing line:** `Cart.findOneAndUpdate({ authId, $or: [{currency: null}, {currency: product.currency}], items: { $elemMatch: { productId, quantity: { $lte: stockQty - delta } } } }, { $inc: { 'items.$.quantity': delta }, $set: { currency: product.currency } })`. If a doc is returned, return its populated response.
3. **Pass 2 — atomic `$push` of new line:** matcher requires `items.productId: { $ne: productObjectId }` and currency null-or-matching. Includes `upsert: true` for the first-ever-add-without-prior-GET case. Stock cap pre-check (`quantity > stockQty` → 409) since fresh push has no prior qty.
4. **Disambiguate misses:** if both passes returned null, re-read the cart once. If currency mismatch → `409 "mixed-currency"`. If existing line and newQty > stockQty → `409 "insufficient stock"`. Otherwise (rare concurrent edge) → `409 "cart concurrent update — please retry"`.

This eliminates the read-mutate-save race: two parallel adds from the same user can no longer lose an increment, because the `$inc` is atomic at the MongoDB layer with stock as a matcher precondition.

### `updateItemQuantity` algorithm

1. `assertObjectId(productId, 'product')`.
2. Load product **without** the active+!deleted filter — existing cart lines for products that were later soft-deleted should still be manageable (reduce qty, then DELETE). Hard-deleted products still 404.
3. Stock check against the absolute new qty (`quantity > product.stockQty` → `409 "insufficient stock"`).
4. `Cart.findOneAndUpdate({ authId, 'items.productId': productObjectId }, { $set: { 'items.$.quantity': quantity } }, { new: true })`. If `null`, no matching line → **`404 "item not in cart"`**.

### `removeItem` algorithm (atomic one-round-trip)

1. `assertObjectId(productId, 'product')`.
2. `Cart.findOneAndUpdate({ authId, 'items.productId': productObjectId }, [aggregationPipeline], { new: true })` — uses an **aggregation-pipeline update** that does both the `$pull` semantics (filter the array) AND the currency cleanup (set to null if the resulting items length is 0) in a single atomic round-trip. If `null` is returned, the line wasn't in the cart → **`404 "item not in cart"`**.

This collapses the previous two-write pattern (pull, then conditional currency reset) into one. The empty-cart ⇒ currency:null invariant is preserved atomically.

### `clearCart` algorithm

`Cart.findOneAndUpdate({ authId }, { $set: { items: [], currency: null }, $setOnInsert: { authId } }, { upsert: true })`. One atomic write; lazy-upserts on the unlikely path where no cart exists yet.

---

## Validators (`src/middleware/validators/cart.validators.js`)

```js
addItemBodySchema    = Joi.object({
  productId: Joi.string().required(),
  quantity:  Joi.number().integer().min(1).max(999).default(1),
}).unknown(false);

updateItemBodySchema = Joi.object({
  quantity:  Joi.number().integer().min(1).max(999).required(),
}).unknown(false);
```

Params (`:productId`) validated by `assertObjectId` inside the service — same pattern as `product.service.js`. No joi param schema.

---

## Route wiring (`src/routes/cart.routes.js`)

Follows the shape of `src/routes/user.routes.js:14-24`:

```js
const cartRouter = Router();
cartRouter.get('/',                  requireAuth, asyncHandler(cartController.getMyCart));
cartRouter.post('/items',            requireAuth, validate(addItemBodySchema),    asyncHandler(cartController.addItem));
cartRouter.patch('/items/:productId', requireAuth, validate(updateItemBodySchema), asyncHandler(cartController.updateItemQuantity));
cartRouter.delete('/items/:productId', requireAuth, asyncHandler(cartController.removeItem));
cartRouter.delete('/',               requireAuth, asyncHandler(cartController.clearCart));
```

Mount in `src/routes/index.js` right after products:

```js
import { cartRouter } from './cart.routes.js';
// ...
apiRouter.use('/cart', cartRouter);
```

---

## Edge cases

| Case | Behavior |
|---|---|
| First-time user calls `GET /cart` | Atomic upsert returns the new empty cart, 200 with `{ items: [], subtotal: 0, itemCount: 0, hasUnavailableItems: false }` |
| Two parallel `GET /cart` from same user (multi-tab) | Both succeed, both return the same `_id` — atomic upsert is idempotent |
| User has a JWT but is `deletedAt` | `requireAuth` 401 — never reaches controller |
| User is `suspendedAt` | `requireAuth` 403 `account suspended` — never reaches controller |
| Product was deleted / inactivated AFTER being added | Item stays in cart. `GET /cart` populates the product with its flags; `subtotal` skips unavailable lines; response carries `hasUnavailableItems: true` |
| Mixed-currency add | `409 "mixed-currency cart not supported"` |
| Add in new currency immediately after removing last item | Succeeds 201 — `removeItem` cleared `currency` on its way out |
| Stock = 0 but product `isActive: true` | `409 "insufficient stock"` — cart never holds 0-qty lines |
| Concurrent adds from two users racing on the last unit | Both succeed at cart layer — cart stock check is advisory; orders PRD enforces at checkout |
| Concurrent adds from the same user for the same product | Atomic `$inc` with positional operator — no lost increments. Stock cap enforced in the matcher precondition |
| PATCH on a cart line whose product was soft-deleted after add | 200 with updated qty — `updateItemQuantity` loads product without active+!deleted filter so existing lines remain manageable |
| `quantity: 0` in body (POST or PATCH) | joi rejects (400) — min is 1; use DELETE to remove |
| PATCH `/cart/items/:productId` where productId not in cart | `404 "item not in cart"` |
| DELETE `/cart/items/:productId` where productId not in cart | `404 "item not in cart"` |
| Invalid ObjectId in any `:productId` path or POST body | `assertObjectId` throws `404 "product not found"` |
| PATCH qty exceeds stockQty (absolute) | `409 "insufficient stock"` |

---

## Open risks

1. **Cart stock check is advisory (two users racing on last unit).** Cart layer does NOT reserve stock — two users can each succeed at adding the last unit. The orders PRD owns the actual reservation/decrement contract. **Mitigation:** documented in the service comments and PRD; orders PRD closes the gap.
2. **Concurrent adds for the same user / same product are atomic.** `addItem` uses a two-pass `findOneAndUpdate` with `$inc` (positional operator) for existing lines and `$push` for new lines, with stock + currency as matcher preconditions. A user double-clicking "Add to cart" no longer loses an increment. If both passes miss, the service disambiguates the failure via a single re-read and returns the correct 409 (mixed-currency or insufficient stock) — or, in the rare concurrent-retry edge, `409 "cart concurrent update — please retry"` instead of a silent 500.
3. **`removeItem` is one atomic update (aggregation pipeline).** Pulls the line and conditionally nulls `currency` if `items` becomes empty, in a single round-trip. The two-write hazard from earlier drafts is gone.
4. **No rate limiting on cart writes.** A malicious user can spam adds/updates. **Mitigation:** authed-only endpoints make the abuse identifiable; add a `cartLimiter` if abuse appears.
5. **`Product.price` is a JS `Number` (float).** Cart subtotal multiplies integer qty by float price; minor precision risk. Mitigated for now by `Math.round(subtotal * 100) / 100` in `buildResponse`. Already flagged in `docs/prd-products.md` to revisit at orders time (switch to integer minor units).
6. **No expiry / abandonment cleanup.** Old carts linger forever. Acceptable — cart docs are tiny, capped by `stockQty` per line.

---

## Verification (manual, 18 smoke probes)

`scripts/cart.http` covers:

1. `GET /cart` unauthed → 401
2. Register + verify-OTP + login → token
3. `GET /cart` authed → 200, atomic upsert creates empty cart
4. `GET /cart` again (same user) → 200, same `_id`
5. Browse products to get a valid `productId` with `stockQty > 5`
6. `POST /cart/items { productId, quantity: 2 }` → 201, cart has 1 line, qty 2
7. `GET /cart` → assert populated product object includes ONLY `name, slug, price, currency, stockQty, isActive, deletedAt, images` (no `description`, `category`, etc.)
8. `POST /cart/items { productId, quantity: 1 }` (same) → 201, qty now 3
9. `POST /cart/items { productId: "<bogus>", quantity: 1 }` → 400 / 404 from `assertObjectId`
10. `POST /cart/items { productId, quantity: 1 }` against an inactive or soft-deleted product → `404 "product not found"`
11. `POST /cart/items { productId, quantity: 9999 }` → `409 "insufficient stock"`
12. `POST /cart/items` for a second product with a DIFFERENT currency → `409 "mixed-currency cart not supported"`
13. `POST /cart/items` for a second product with the SAME currency → 201
14. `PATCH /cart/items/:productId { quantity: 1 }` → 200, line updated
15. `PATCH /cart/items/:productId { quantity: 0 }` → 400
16. `PATCH /cart/items/:productId { quantity: <stockQty + 1> }` → `409 "insufficient stock"`
17. `PATCH /cart/items/<productId-NOT-in-cart>` → `404 "item not in cart"`
18. `DELETE /cart/items/:productId` → 200
19. `DELETE /cart/items/<productId-NOT-in-cart>` → `404 "item not in cart"`
20. Remove last item, then `POST /cart/items` in a NEW currency → 201
21. `DELETE /cart` → 200, cart `{ items: [], currency: null }`
22. Admin soft-deletes a product mid-cart; `GET /cart` → still shows the line, `hasUnavailableItems: true`, subtotal excludes it
23. Admin suspends the user; `GET /cart` → 403

Run:
```
npm run dev
# In another shell, drive scripts/cart.http with the REST client extension or curl.
```

`node --check` on every new file before manual probes.

---

## Failure modes

| Codepath | Realistic failure | Coverage | Error handling | User-visible? |
|---|---|---|---|---|
| `getMyCart` atomic upsert | Mongo connection drop mid-upsert | Infra-level, not probed | `errorHandler` → 500 generic body | yes, generic 500 |
| `addItem` product lookup | Product soft-deleted between read and write | probe 22 | line stays with `hasUnavailableItems: true` next GET | yes, on next GET |
| `addItem` stock check | Two users racing on last unit | not probed; intentional | both succeed at cart layer | no until checkout (orders PRD) |
| `addItem` currency lock | First add races with cart upsert | acceptable; last writer wins | document in §Open risks | rare, small window |
| `updateItemQuantity` line not found | Stale frontend PATCHes a removed line | probe 17 | `404 "item not in cart"` | yes, clear error |
| `removeItem` line not found | Stale frontend DELETEs a removed line | probe 19 | `404 "item not in cart"` | yes, clear error |
| `removeItem` currency cleanup | DB error between `$pull` and follow-up `$set` | not probed; would need fault injection | empty cart with stale currency lock; self-heals | rare; PRD §Open risks #2 |

**No critical gaps.** Every documented failure has either a probe or a documented "intentionally accepted" rationale tied to the orders PRD.

---

## Wiki updates (deferred to end-of-session per CLAUDE.md)

Not written mid-implementation. After the user runs the end-of-session capture prompt:
- `../e-commerce-wiki/wiki/flows/cart.md` — full cart flow.
- `../e-commerce-wiki/raw/features/2026-05-12-cart.md` — this PRD as written.
- `../e-commerce-wiki/raw/sessions/2026-05-12-cart-shipped.md` — session log.
- Inline within the flow page (no separate decision files unless re-litigated): the locked decisions above.
- Append one line to `../e-commerce-wiki/log.md`.

---

## Implementation order

1. `src/models/Cart.js`
2. `src/middleware/validators/cart.validators.js`
3. `src/services/cart.service.js` — atomic upsert in `getMyCart`; allowlist populate; 404 on missing line in `updateItemQuantity` / `removeItem`; currency-clear-on-last-pull in `removeItem`.
4. `src/controllers/cart.controller.js`
5. `src/routes/cart.routes.js`
6. `src/routes/index.js` — mount `cartRouter` at `/cart`.
7. `scripts/cart.http` — 23 probes (including the 7 added by eng review).
8. `node --check` on each new file.
9. `npm run dev` + run probes manually.
