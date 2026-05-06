import mongoose from 'mongoose';

import { Auth } from '../models/Auth.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { authService } from './auth.service.js';

export const userService = {
  async getMe(user) {
    // user is already loaded fresh by requireAuth, just return it.
    return user;
  },

  async updateMe(authId, fields) {
    // joi has already enforced the allowlist — just persist.
    const updated = await User.findOneAndUpdate(
      { authId, deletedAt: null },
      { $set: fields },
      { new: true, runValidators: true },
    ).lean();
    if (!updated) {
      throw new ApiError(401, 'invalid credentials');
    }
    return updated;
  },

  async softDeleteSelf(authId) {
    const now = new Date();
    await authService.setAccountStatus(authId, { deletedAt: now });
    return { message: 'account deleted' };
  },

  async listUsers() {
    const users = await User.find({ deletedAt: null })
      .sort({ createdAt: -1 })
      .lean();
    return users;
  },

  async getUserById(id) {
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'user not found');
    }
    const user = await User.findOne({ _id: id, deletedAt: null }).lean();
    if (!user) {
      throw new ApiError(404, 'user not found');
    }
    return user;
  },

  async softDeleteUser(id) {
    if (!mongoose.isValidObjectId(id)) {
      throw new ApiError(404, 'user not found');
    }
    const user = await User.findOne({ _id: id, deletedAt: null });
    if (!user) {
      throw new ApiError(404, 'user not found');
    }
    // Also flip auth.deletedAt — login is gated on it.
    const auth = await Auth.findById(user.authId);
    if (!auth) {
      throw new ApiError(404, 'user not found');
    }
    await authService.setAccountStatus(auth._id, { deletedAt: new Date() });
    return { message: 'user deleted' };
  },
};
