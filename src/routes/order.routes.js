import { Router } from 'express';

import { orderController } from '../controllers/order.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const orderRouter = Router();

orderRouter.get('/', asyncHandler(orderController.list));
orderRouter.get('/:id', asyncHandler(orderController.getById));
orderRouter.post('/', asyncHandler(orderController.create));
orderRouter.patch('/:id', asyncHandler(orderController.update));
orderRouter.delete('/:id', asyncHandler(orderController.remove));

export { orderRouter };
