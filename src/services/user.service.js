import { ApiError } from '../utils/ApiError.js';

export const userService = {
  async list() {
    return [];
  },

  async getById(id) {
    throw new ApiError(404, `User ${id} not found`);
  },

  async create(payload) {
    throw new ApiError(501, 'user.create not implemented');
  },

  async update(id, payload) {
    throw new ApiError(501, 'user.update not implemented');
  },

  async remove(id) {
    throw new ApiError(501, 'user.remove not implemented');
  },
};
