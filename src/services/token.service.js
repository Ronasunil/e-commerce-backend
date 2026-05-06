import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';

import { config } from '../config/env.js';

export const tokenService = {
  signJwt(payload) {
    return jwt.sign(payload, config.jwt.secret, {
      algorithm: 'HS256',
      expiresIn: config.jwt.expiresIn,
    });
  },

  verifyJwt(token) {
    return jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  },

  sha256(input) {
    return crypto.createHash('sha256').update(String(input)).digest('hex');
  },

  randomToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
  },
};
