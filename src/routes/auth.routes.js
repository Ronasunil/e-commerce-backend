import { Router } from 'express';

import { authController } from '../controllers/auth.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import {
  registerSchema,
  loginSchema,
  otpSchema,
  resendOtpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  changePasswordSchema,
} from '../middleware/validators/auth.validators.js';

const authRouter = Router();

// Public
authRouter.post(
  '/register',
  validate(registerSchema),
  asyncHandler(authController.register),
);
authRouter.post(
  '/verify-otp',
  validate(otpSchema),
  asyncHandler(authController.verifyOtp),
);
authRouter.post(
  '/resend-otp',
  validate(resendOtpSchema),
  asyncHandler(authController.resendOtp),
);
authRouter.post(
  '/login',
  validate(loginSchema),
  asyncHandler(authController.login),
);
authRouter.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  asyncHandler(authController.forgotPassword),
);
authRouter.post(
  '/reset-password',
  validate(resetPasswordSchema),
  asyncHandler(authController.resetPassword),
);

// Authed
authRouter.post('/logout', requireAuth, asyncHandler(authController.logout));
authRouter.post(
  '/change-password',
  requireAuth,
  validate(changePasswordSchema),
  asyncHandler(authController.changePassword),
);

export { authRouter };
