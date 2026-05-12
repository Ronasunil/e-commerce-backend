import { Router } from 'express';

import { cartController } from '../controllers/cart.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { validate } from '../middleware/validate.js';
import {
  addItemBodySchema,
  updateItemBodySchema,
} from '../middleware/validators/cart.validators.js';

const cartRouter = Router();

cartRouter.use(requireAuth);

cartRouter.get('/', asyncHandler(cartController.getMyCart));

cartRouter.post(
  '/items',
  validate(addItemBodySchema),
  asyncHandler(cartController.addItem),
);

cartRouter.patch(
  '/items/:productId',
  validate(updateItemBodySchema),
  asyncHandler(cartController.updateItemQuantity),
);

cartRouter.delete('/items/:productId', asyncHandler(cartController.removeItem));

cartRouter.delete('/', asyncHandler(cartController.clearCart));

export { cartRouter };
