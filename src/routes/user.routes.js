import { Router } from 'express';

import { userController } from '../controllers/user.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const userRouter = Router();

userRouter.get('/', asyncHandler(userController.list));
userRouter.get('/:id', asyncHandler(userController.getById));
userRouter.post('/', asyncHandler(userController.create));
userRouter.patch('/:id', asyncHandler(userController.update));
userRouter.delete('/:id', asyncHandler(userController.remove));

export { userRouter };
