import { ApiError } from '../utils/ApiError.js';

export const productService = {
  async list(query) {
    return [];
  },

  async getById(id) {
    throw new ApiError(404, `Product ${id} not found`);
  },

  async create(payload) {
    throw new ApiError(501, 'product.create not implemented');
  },

  async update(id, payload) {
    throw new ApiError(501, 'product.update not implemented');
  },

  async remove(id) {
    throw new ApiError(501, 'product.remove not implemented');
  },
};
