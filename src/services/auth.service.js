import { ApiError } from '../utils/ApiError.js';

export const authService = {
  async register(payload) {
    throw new ApiError(501, 'auth.register not implemented');
  },

  async login(payload) {
    throw new ApiError(501, 'auth.login not implemented');
  },
};
