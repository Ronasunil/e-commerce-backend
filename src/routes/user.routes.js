import { Router } from 'express';

import { userController } from '../controllers/user.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import { updateMeSchema } from '../middleware/validators/user.validators.js';

const userRouter = Router();

// Self-service (authed)
userRouter.get('/me', requireAuth, asyncHandler(userController.getMe));
userRouter.patch(
  '/me',
  requireAuth,
  validate(updateMeSchema),
  asyncHandler(userController.updateMe),
);
userRouter.delete('/me', requireAuth, asyncHandler(userController.deleteMe));

// Admin
userRouter.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(userController.listUsers),
);
userRouter.get(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(userController.getUserById),
);
userRouter.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  asyncHandler(userController.deleteUser),
);

export { userRouter };
