import mongoose from 'mongoose';

import { Cart } from '../models/Cart.js';
import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { assertObjectId } from '../utils/assertObjectId.js';

const PRODUCT_POPULATE_FIELDS =
  'name slug price currency stockQty isActive deletedAt images';

// Atomic upsert. Parallel GETs from the same user converge on one doc; no
// E11000 race surface against the unique authId index.
const upsertCart = async (authId) =>
  Cart.findOneAndUpdate(
    { authId },
    { $setOnInsert: { authId, items: [], currency: null } },
    { upsert: true, new: true },
  );

const loadActiveProduct = async (productId) => {
  assertObjectId(productId, 'product');
  const product = await Product.findOne({
    _id: productId,
    isActive: true,
    deletedAt: null,
  }).lean();
  if (!product) {
    throw new ApiError(404, 'product not found');
  }
  return product;
};

// For PATCH/DELETE on an existing cart line: the product may have been
// soft-deleted or marked inactive since it was added. We still want the user
// to be able to manage their existing line (reduce qty, remove), so we load
// by id without the active+!deleted filter. Hard-deleted products still 404.
const loadAnyProduct = async (productId) => {
  assertObjectId(productId, 'product');
  const product = await Product.findById(productId).lean();
  if (!product) {
    throw new ApiError(404, 'product not found');
  }
  return product;
};

const buildResponse = (cart) => {
  const json = cart.toJSON();
  let subtotal = 0;
  let itemCount = 0;
  let hasUnavailableItems = false;

  for (const line of json.items) {
    itemCount += line.quantity;
    const product = line.productId;
    // Populated lines have an object; raw ObjectId means populate skipped
    // (or product doc was hard-deleted). Treat absent product as unavailable.
    if (
      product &&
      typeof product === 'object' &&
      product.isActive === true &&
      product.deletedAt === null
    ) {
      subtotal += product.price * line.quantity;
    } else {
      hasUnavailableItems = true;
    }
  }

  subtotal = Math.round(subtotal * 100) / 100;

  return { cart: json, subtotal, itemCount, hasUnavailableItems };
};

export const cartService = {
  async getMyCart(authId) {
    const cart = await upsertCart(authId);
    await cart.populate('items.productId', PRODUCT_POPULATE_FIELDS);
    return buildResponse(cart);
  },

  async addItem(authId, { productId, quantity }) {
    const product = await loadActiveProduct(productId);
    const productObjectId = new mongoose.Types.ObjectId(String(product._id));
    const currencyOk = [{ currency: null }, { currency: product.currency }];

    // Guarantee the cart exists before the two passes. Without this, parallel
    // first-adds for the same user would both attempt to upsert and one would
    // hit E11000 on the unique authId index (surfaces as 500).
    await upsertCart(authId);

    // Pass 1: atomic $inc on an existing line, with stock cap and currency
    // lock as preconditions. If the matcher fails (no existing line, stock
    // would overflow, or currency mismatch), the update returns null and we
    // try Pass 2.
    const incremented = await Cart.findOneAndUpdate(
      {
        authId,
        $or: currencyOk,
        items: {
          $elemMatch: {
            productId: productObjectId,
            quantity: { $lte: product.stockQty - quantity },
          },
        },
      },
      {
        $inc: { 'items.$.quantity': quantity },
        $set: { currency: product.currency },
      },
      { new: true },
    );
    if (incremented) {
      await incremented.populate('items.productId', PRODUCT_POPULATE_FIELDS);
      return buildResponse(incremented);
    }

    // Pass 2: atomic $push of a new line. Matcher requires the product NOT to
    // already be in items[] and currency to be null or matching. Cart exists
    // by now (upsertCart above), so upsert: false is safe and avoids E11000.
    if (quantity > product.stockQty) {
      throw new ApiError(409, 'insufficient stock', {
        details: { stockQty: product.stockQty, requested: quantity },
      });
    }
    const pushed = await Cart.findOneAndUpdate(
      {
        authId,
        'items.productId': { $ne: productObjectId },
        $or: currencyOk,
      },
      {
        $push: {
          items: {
            productId: productObjectId,
            quantity,
            addedAt: new Date(),
          },
        },
        $set: { currency: product.currency },
      },
      { new: true },
    );
    if (pushed) {
      await pushed.populate('items.productId', PRODUCT_POPULATE_FIELDS);
      return buildResponse(pushed);
    }

    // Both passes missed. Re-read to disambiguate the failure reason.
    const cart = await Cart.findOne({ authId }).lean();
    if (cart?.currency && cart.currency !== product.currency) {
      throw new ApiError(409, 'mixed-currency cart not supported');
    }
    const existing = cart?.items.find(
      (l) => String(l.productId) === String(product._id),
    );
    if (existing) {
      const newQty = existing.quantity + quantity;
      if (newQty > product.stockQty) {
        throw new ApiError(409, 'insufficient stock', {
          details: { stockQty: product.stockQty, requested: newQty },
        });
      }
    }
    // Reached only under a concurrent-retry edge — surface as 409 so the
    // client can decide to retry without seeing a 500.
    throw new ApiError(409, 'cart concurrent update — please retry');
  },

  async updateItemQuantity(authId, productId, quantity) {
    // PATCH must work on lines whose product was later soft-deleted, so we
    // load without the active+!deleted filter. Stock check still runs against
    // the product's current stockQty (advisory; orders PRD owns reservation).
    const product = await loadAnyProduct(productId);
    const productObjectId = new mongoose.Types.ObjectId(String(product._id));

    if (quantity > product.stockQty) {
      throw new ApiError(409, 'insufficient stock', {
        details: { stockQty: product.stockQty, requested: quantity },
      });
    }

    const updated = await Cart.findOneAndUpdate(
      { authId, 'items.productId': productObjectId },
      { $set: { 'items.$.quantity': quantity } },
      { new: true },
    );
    if (!updated) {
      throw new ApiError(404, 'item not in cart');
    }
    await updated.populate('items.productId', PRODUCT_POPULATE_FIELDS);
    return buildResponse(updated);
  },

  async removeItem(authId, productId) {
    assertObjectId(productId, 'product');
    const productObjectId = new mongoose.Types.ObjectId(String(productId));

    // Aggregation-pipeline update: atomic $pull semantics + currency cleanup
    // in one round-trip. Without the pipeline form we'd need two writes; this
    // collapses to one and preserves the empty-cart ⇒ currency: null invariant.
    const updated = await Cart.findOneAndUpdate(
      { authId, 'items.productId': productObjectId },
      [
        {
          $set: {
            items: {
              $filter: {
                input: '$items',
                cond: { $ne: ['$$this.productId', productObjectId] },
              },
            },
          },
        },
        {
          $set: {
            currency: {
              $cond: [
                { $eq: [{ $size: '$items' }, 0] },
                null,
                '$currency',
              ],
            },
          },
        },
      ],
      { new: true },
    );
    if (!updated) {
      throw new ApiError(404, 'item not in cart');
    }
    await updated.populate('items.productId', PRODUCT_POPULATE_FIELDS);
    return buildResponse(updated);
  },

  async clearCart(authId) {
    await Cart.findOneAndUpdate(
      { authId },
      { $set: { items: [], currency: null }, $setOnInsert: { authId } },
      { upsert: true },
    );
    return { message: 'cart cleared' };
  },
};
