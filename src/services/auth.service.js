import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';

import { config } from '../config/env.js';
import { Auth } from '../models/Auth.js';
import { User } from '../models/User.js';
import { ApiError } from '../utils/ApiError.js';
import { otpService } from './otp.service.js';
import { tokenService } from './token.service.js';

const isDup = (err) => err && err.code === 11000;

const issueToken = (authId) =>
  tokenService.signJwt({ sub: String(authId) });

/**
 * Sole writer of `isVerified` and `deletedAt` across both `auth` and `users`
 * collections after register. Wraps both writes in a Mongo transaction so
 * either both commit or neither does.
 */
const setAccountStatus = async (authId, fields) => {
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Auth.updateOne({ _id: authId }, fields, { session });
      await User.updateOne({ authId }, fields, { session });
    });
  } finally {
    await session.endSession();
  }
};

export const authService = {
  async register({ email, username, password }) {
    // Friendly common-case pre-check (E11000 catch below covers the race).
    const existing = await Auth.findOne({
      $or: [{ email }, { username }],
    }).lean();
    if (existing) {
      throw new ApiError(409, 'email or username already in use');
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const { otp, otpHash, otpExpiresAt } = otpService.generate();

    const authId = new mongoose.Types.ObjectId();
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await Auth.create(
          [
            {
              _id: authId,
              email,
              username,
              passwordHash,
              isVerified: false,
              otpHash,
              otpExpiresAt,
              otpAttempts: 0,
            },
          ],
          { session },
        );
        await User.create(
          [
            {
              authId,
              email,
              username,
              role: 'user',
              isVerified: false,
            },
          ],
          { session },
        );
      });
    } catch (err) {
      if (isDup(err)) {
        throw new ApiError(409, 'email or username already in use');
      }
      throw err;
    } finally {
      await session.endSession();
    }

    if (otpService.isDummy()) {
      console.log(`OTP for ${email}: ${otpService.dummyValue()}`);
    } else {
      console.log(`OTP for ${email}: ${otp} (expires in ${config.otp.expiryMin}m)`);
    }

    return { authId: String(authId), message: 'verify with /auth/verify-otp' };
  },

  async verifyOtp({ authId, otp }) {
    if (!mongoose.isValidObjectId(authId)) {
      throw new ApiError(400, 'invalid authId');
    }
    const auth = await Auth.findById(authId);
    if (!auth || auth.deletedAt) {
      throw new ApiError(400, 'invalid authId');
    }
    if (auth.isVerified) {
      throw new ApiError(400, 'already verified');
    }

    if (!otpService.isDummy()) {
      if (auth.otpAttempts >= 5) {
        throw new ApiError(429, 'too many otp attempts; request a new code');
      }
      if (!otpService.verify(otp, auth)) {
        auth.otpAttempts += 1;
        await auth.save();
        throw new ApiError(400, 'invalid or expired otp');
      }
    } else if (!otpService.verify(otp, auth)) {
      throw new ApiError(400, 'invalid or expired otp');
    }

    await setAccountStatus(auth._id, { isVerified: true });
    auth.otpHash = null;
    auth.otpExpiresAt = null;
    auth.otpAttempts = 0;
    await auth.save();

    const user = await User.findOne({ authId: auth._id }).lean();
    return { token: issueToken(auth._id), user };
  },

  async resendOtp({ authId }) {
    if (!mongoose.isValidObjectId(authId)) {
      throw new ApiError(400, 'invalid authId');
    }
    const auth = await Auth.findById(authId);
    if (!auth || auth.deletedAt) {
      throw new ApiError(400, 'invalid authId');
    }
    if (auth.isVerified) {
      throw new ApiError(400, 'already verified');
    }

    const { otp, otpHash, otpExpiresAt } = otpService.generate();
    auth.otpHash = otpHash;
    auth.otpExpiresAt = otpExpiresAt;
    auth.otpAttempts = 0;
    await auth.save();

    if (otpService.isDummy()) {
      console.log(`OTP for ${auth.email}: ${otpService.dummyValue()}`);
    } else {
      console.log(`OTP for ${auth.email}: ${otp} (expires in ${config.otp.expiryMin}m)`);
    }
    return { message: 'otp resent' };
  },

  async login({ emailOrUsername, password }) {
    const lookup = String(emailOrUsername || '').toLowerCase().trim();
    const auth = await Auth.findOne({
      $or: [{ email: lookup }, { username: lookup }],
    });

    if (!auth || auth.deletedAt) {
      throw new ApiError(401, 'invalid credentials');
    }
    if (!auth.isVerified) {
      throw new ApiError(403, 'unverified', {
        code: 'UNVERIFIED',
        authId: String(auth._id),
      });
    }

    const ok = await bcrypt.compare(password, auth.passwordHash);
    if (!ok) {
      throw new ApiError(401, 'invalid credentials');
    }

    const user = await User.findOne({ authId: auth._id }).lean();
    return { token: issueToken(auth._id), user };
  },

  async logout() {
    // Plain JWT has no server-side state. Client deletes the token.
    return { message: 'logged out' };
  },

  async forgotPassword({ email }) {
    const lookup = String(email || '').toLowerCase().trim();
    const auth = await Auth.findOne({ email: lookup });

    // Always return 200 — no enumeration. Only do work if the account exists and isn't deleted.
    if (auth && !auth.deletedAt) {
      const token = tokenService.randomToken(32);
      auth.passwordResetTokenHash = tokenService.sha256(token);
      auth.passwordResetExpiresAt = new Date(
        Date.now() + config.resetToken.expiryMin * 60 * 1000,
      );
      await auth.save();
      console.log(
        `Password reset token for ${auth.email}: ${token} (expires in ${config.resetToken.expiryMin}m)`,
      );
    }

    return { message: 'if the email exists, a reset link has been sent' };
  },

  async resetPassword({ token, newPassword }) {
    const tokenHash = tokenService.sha256(token);
    const auth = await Auth.findOne({
      passwordResetTokenHash: tokenHash,
      passwordResetExpiresAt: { $gt: new Date() },
      deletedAt: null,
    });

    if (!auth) {
      throw new ApiError(400, 'invalid or expired reset token');
    }

    auth.passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
    auth.passwordResetTokenHash = null;
    auth.passwordResetExpiresAt = null;
    await auth.save();

    return { message: 'password reset' };
  },

  async changePassword({ authId, currentPassword, newPassword }) {
    const auth = await Auth.findById(authId);
    if (!auth || auth.deletedAt) {
      throw new ApiError(401, 'invalid credentials');
    }
    const ok = await bcrypt.compare(currentPassword, auth.passwordHash);
    if (!ok) {
      throw new ApiError(401, 'invalid credentials');
    }
    auth.passwordHash = await bcrypt.hash(newPassword, config.bcryptRounds);
    await auth.save();
    return { message: 'password changed' };
  },

  // Exported so user.service.softDeleteSelf can use the same helper.
  setAccountStatus,
};
