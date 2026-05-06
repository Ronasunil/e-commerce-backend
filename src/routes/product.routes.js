import { Router } from 'express';

import { productController } from '../controllers/product.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const productRouter = Router();

productRouter.get('/', asyncHandler(productController.list));
productRouter.get('/:id', asyncHandler(productController.getById));
productRouter.post('/', asyncHandler(productController.create));
productRouter.patch('/:id', asyncHandler(productController.update));
productRouter.delete('/:id', asyncHandler(productController.remove));

export { productRouter };
