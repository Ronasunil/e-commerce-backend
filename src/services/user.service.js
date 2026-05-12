import { Auth } from '../models/Auth.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { assertObjectId } from '../utils/assertObjectId.js';
import { escapeRegex } from '../utils/escapeRegex.js';
import { authService } from './auth.service.js';

// Shared guard: prevent leaving the system without an active admin.
// Used by updateUserRole and suspendUser; will pick up admin self-delete later.
const _assertNotLastAdmin = async (target, action /* 'demote' | 'suspend' */) => {
  if (target.role !== 'admin') return;
  const activeAdmins = await User.countDocuments({
    role: 'admin',
    deletedAt: null,
    suspendedAt: null,
  });
  if (activeAdmins <= 1) {
    throw new ApiError(400, `cannot ${action} the last admin`);
  }
};

export const userService = {
  async getMe(user) {
    return user;
  },

  async updateMe(authId, fields) {
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

  async listUsers({ page, limit, q, role, isVerified, status }) {
    const filter = {};

    if (q && q.length > 0) {
      const rx = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ email: rx }, { username: rx }];
    }
    if (role) filter.role = role;
    if (isVerified !== undefined) filter.isVerified = isVerified;

    if (status === 'active') {
      filter.deletedAt = null;
      filter.suspendedAt = null;
    } else if (status === 'suspended') {
      filter.deletedAt = null;
      filter.suspendedAt = { $ne: null };
    } else if (status === 'deleted') {
      filter.deletedAt = { $ne: null };
    }
    // status === 'all' adds no lifecycle clauses.

    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    return {
      data,
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit) || 0,
    };
  },

  async getUserById(id) {
    assertObjectId(id, 'user');
    const user = await User.findOne({ _id: id, deletedAt: null }).lean();
    if (!user) {
      throw new ApiError(404, 'user not found');
    }
    return user;
  },

  async softDeleteUser(id) {
    assertObjectId(id, 'user');
    const user = await User.findOne({ _id: id, deletedAt: null });
    if (!user) {
      throw new ApiError(404, 'user not found');
    }
    const auth = await Auth.findById(user.authId);
    if (!auth) {
      throw new ApiError(404, 'user not found');
    }
    await authService.setAccountStatus(auth._id, { deletedAt: new Date() });
    return { message: 'user deleted' };
  },

  async updateUserRole(actingAuthId, id, newRole) {
    assertObjectId(id, 'user');
    const target = await User.findOne({
      _id: id,
      deletedAt: null,
      suspendedAt: null,
    });
    if (!target) {
      throw new ApiError(404, 'user not found');
    }
    if (target.role === newRole) {
      return target.toObject();
    }
    if (
      String(target.authId) === String(actingAuthId) &&
      newRole !== 'admin'
    ) {
      throw new ApiError(400, 'cannot demote yourself');
    }
    if (target.role === 'admin' && newRole !== 'admin') {
      await _assertNotLastAdmin(target, 'demote');
    }
    target.role = newRole;
    await target.save();
    return target.toObject();
  },

  async suspendUser(actingAuthId, id) {
    assertObjectId(id, 'user');
    const target = await User.findById(id);
    if (!target) {
      throw new ApiError(404, 'user not found');
    }
    if (target.deletedAt) {
      throw new ApiError(409, 'cannot suspend a deleted user');
    }
    if (target.suspendedAt) {
      throw new ApiError(409, 'user already suspended');
    }
    if (String(target.authId) === String(actingAuthId)) {
      throw new ApiError(400, 'cannot suspend yourself');
    }
    await _assertNotLastAdmin(target, 'suspend');

    const suspendedAt = new Date();
    await authService.setAccountStatus(target.authId, { suspendedAt });
    return { message: 'user suspended', id: String(target._id), suspendedAt };
  },

  async unsuspendUser(id) {
    assertObjectId(id, 'user');
    // Deliberately exclude deleted users — admin must restore first.
    const target = await User.findOne({
      _id: id,
      suspendedAt: { $ne: null },
      deletedAt: null,
    });
    if (!target) {
      throw new ApiError(404, 'user not suspended');
    }
    await authService.setAccountStatus(target.authId, { suspendedAt: null });
    const user = await User.findById(target._id).lean();
    return { message: 'user unsuspended', user };
  },

  async restoreUser(id) {
    assertObjectId(id, 'user');
    const target = await User.findOne({
      _id: id,
      deletedAt: { $ne: null },
    });
    if (!target) {
      throw new ApiError(404, 'user not deleted');
    }
    await authService.setAccountStatus(target.authId, { deletedAt: null });
    // Return resulting user state so admin sees if suspendedAt is still set
    // (deleted-and-suspended → restore → still suspended; needs separate unsuspend).
    const user = await User.findById(target._id).lean();
    return { message: 'user restored', user };
  },
};
