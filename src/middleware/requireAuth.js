import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { tokenService } from '../services/token.service.js';

/**
 * Verifies JWT signature, extracts authId, loads the user fresh from DB on
 * every request. 401 if token invalid/expired or user soft-deleted; 403 if
 * suspended (matches login surface, so admin-driven suspension is observable
 * to the holder of an existing JWT). With the always-on transaction in
 * setAccountStatus, users.{deletedAt,suspendedAt} are in sync with their auth
 * counterparts, so checking only users suffices (saves an auth.findOne).
 */
export const requireAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw new ApiError(401, 'invalid credentials');
    }
    const token = header.slice('Bearer '.length).trim();

    let payload;
    try {
      payload = tokenService.verifyJwt(token);
    } catch {
      throw new ApiError(401, 'invalid credentials');
    }

    const authId = payload.sub;
    if (!authId) throw new ApiError(401, 'invalid credentials');

    const user = await User.findOne({ authId, deletedAt: null });
    if (!user) throw new ApiError(401, 'invalid credentials');
    if (user.suspendedAt) throw new ApiError(403, 'account suspended');

    req.authId = user.authId;
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
