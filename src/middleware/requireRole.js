import { ApiError } from '../utils/ApiError.js';

/**
 * Reads req.user.role (loaded fresh by requireAuth on every request).
 * Mount AFTER requireAuth.
 */
export const requireRole = (role) => (req, _res, next) => {
  if (!req.user) {
    return next(new ApiError(401, 'invalid credentials'));
  }
  if (req.user.role !== role) {
    return next(new ApiError(403, 'forbidden'));
  }
  next();
};
