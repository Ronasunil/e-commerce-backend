import { ApiError } from '../utils/ApiError.js';

export const orderService = {
  async list(query) {
    return [];
  },

  async getById(id) {
    throw new ApiError(404, `Order ${id} not found`);
  },

  async create(payload) {
    throw new ApiError(501, 'order.create not implemented');
  },

  async update(id, payload) {
    throw new ApiError(501, 'order.update not implemented');
  },

  async remove(id) {
    throw new ApiError(501, 'order.remove not implemented');
  },
};
