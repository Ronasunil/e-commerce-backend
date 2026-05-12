import { Product } from '../models/Product.js';
import { ApiError } from '../utils/ApiError.js';
import { assertObjectId } from '../utils/assertObjectId.js';
import { escapeRegex } from '../utils/escapeRegex.js';

const isDuplicateSlug = (err) =>
  err?.code === 11000 && err?.keyPattern?.slug;

const paginate = async (filter, { page, limit }) => {
  const skip = (page - 1) * limit;
  const [data, total] = await Promise.all([
    Product.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Product.countDocuments(filter),
  ]);
  return {
    data,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
};

const applyTextFilters = (filter, { q, category }) => {
  if (q && q.length > 0) {
    filter.name = new RegExp(escapeRegex(q), 'i');
  }
  if (category) {
    filter.category = category;
  }
};

export const productService = {
  // -- Public reads -----------------------------------------------------------

  async listPublic({ page, limit, q, category }) {
    const filter = { deletedAt: null, isActive: true };
    applyTextFilters(filter, { q, category });
    return paginate(filter, { page, limit });
  },

  async getPublicById(id) {
    assertObjectId(id, 'product');
    const product = await Product.findOne({
      _id: id,
      deletedAt: null,
      isActive: true,
    }).lean();
    if (!product) {
      throw new ApiError(404, 'product not found');
    }
    return product;
  },

  // -- Admin reads ------------------------------------------------------------

  async listAll({ page, limit, q, category, status }) {
    let filter;
    switch (status) {
      case 'live':
        filter = { deletedAt: null, isActive: true };
        break;
      case 'draft':
        filter = { deletedAt: null, isActive: false };
        break;
      case 'deleted':
        filter = { deletedAt: { $ne: null } };
        break;
      case 'all':
        filter = {};
        break;
      default:
        // admin default: all non-deleted (drafts + live, no trash)
        filter = { deletedAt: null };
    }
    applyTextFilters(filter, { q, category });
    return paginate(filter, { page, limit });
  },

  async getAnyById(id) {
    assertObjectId(id, 'product');
    const product = await Product.findById(id).lean();
    if (!product) {
      throw new ApiError(404, 'product not found');
    }
    return product;
  },

  // -- Admin writes -----------------------------------------------------------

  async create(payload) {
    try {
      const product = await Product.create(payload);
      return product.toJSON();
    } catch (err) {
      if (isDuplicateSlug(err)) {
        throw new ApiError(409, 'slug already exists');
      }
      throw err;
    }
  },

  async update(id, payload) {
    assertObjectId(id, 'product');
    try {
      const product = await Product.findByIdAndUpdate(
        id,
        { $set: payload },
        { new: true, runValidators: true },
      ).lean();
      if (!product) {
        throw new ApiError(404, 'product not found');
      }
      return product;
    } catch (err) {
      if (isDuplicateSlug(err)) {
        throw new ApiError(409, 'slug already exists');
      }
      throw err;
    }
  },

  async remove(id) {
    assertObjectId(id, 'product');
    const product = await Product.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: { deletedAt: new Date() } },
      { new: true },
    ).lean();
    if (!product) {
      throw new ApiError(404, 'product not found');
    }
    return {
      message: 'product deleted',
      id: String(product._id),
      deletedAt: product.deletedAt,
    };
  },

  async restore(id) {
    assertObjectId(id, 'product');
    const product = await Product.findOneAndUpdate(
      { _id: id, deletedAt: { $ne: null } },
      { $set: { deletedAt: null } },
      { new: true },
    ).lean();
    if (!product) {
      throw new ApiError(404, 'product not deleted');
    }
    return { message: 'product restored', product };
  },
};
