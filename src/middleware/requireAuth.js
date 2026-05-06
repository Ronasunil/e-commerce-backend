import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { tokenService } from '../services/token.service.js';

/**
 * Verifies JWT signature, extracts authId, loads the user fresh from DB on
 * every request. 401 if token invalid/expired or user soft-deleted. With the
 * always-on transaction in setAccountStatus, users.deletedAt is in sync with
 * auth.deletedAt, so checking only users suffices (saves an auth.findOne).
 */
export const requireAuth = async (req, _res, next) => {
  try {
    const header = req.headers.authorization || '';
    if (!header.startsWith('Bearer ')) {
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

    req.authId = user.authId;
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};
