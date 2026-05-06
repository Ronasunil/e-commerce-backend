import crypto from 'node:crypto';

import { config } from '../config/env.js';
import { tokenService } from './token.service.js';

const DUMMY_OTP = '1234';
const CLOCK_SKEW_MS = 60 * 1000; // ±1 min tolerance per PRD

export const otpService = {
  /**
   * Returns { otpHash, otpExpiresAt } to persist on the auth doc.
   * In dummy mode, returns nulls — verify() will accept "1234".
   */
  generate() {
    if (config.otp.dummy) {
      return { otpHash: null, otpExpiresAt: null };
    }
    const otp = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const otpHash = tokenService.sha256(otp);
    const otpExpiresAt = new Date(
      Date.now() + config.otp.expiryMin * 60 * 1000,
    );
    // Returning the cleartext otp for the caller to log/send is intentional.
    return { otp, otpHash, otpExpiresAt };
  },

  /**
   * Verifies the submitted OTP against the auth doc's stored hash + expiry.
   * Returns true on success, false on failure (caller decides how to react).
   */
  verify(submitted, authDoc) {
    if (config.otp.dummy) {
      return submitted === DUMMY_OTP;
    }
    if (!authDoc.otpHash || !authDoc.otpExpiresAt) return false;
    if (authDoc.otpExpiresAt.getTime() + CLOCK_SKEW_MS < Date.now()) {
      return false;
    }
    return tokenService.sha256(submitted) === authDoc.otpHash;
  },

  isDummy() {
    return config.otp.dummy;
  },

  dummyValue() {
    return DUMMY_OTP;
  },
};
