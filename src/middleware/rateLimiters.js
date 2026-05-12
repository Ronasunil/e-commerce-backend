import rateLimit from 'express-rate-limit';

import { isDevelopment } from '../config/env.js';

const tooManyRequests = (_req, res) => {
  res.status(429).json({
    error: { message: 'too many requests, please try again later' },
  });
};

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isDevelopment ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: tooManyRequests,
});
