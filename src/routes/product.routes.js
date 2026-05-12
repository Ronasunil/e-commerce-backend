import { Router } from 'express';

import { productController } from '../controllers/product.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { validate } from '../middleware/validate.js';
import { listPublicProductsQuerySchema } from '../middleware/validators/product.validators.js';

const productRouter = Router();

// Public catalog. No auth middleware: anyone can browse, even with no token
// or a bad token. The service hard-filters to live products only.

productRouter.get(
  '/',
  validate(listPublicProductsQuerySchema, 'query'),
  asyncHandler(productController.publicList),
);

productRouter.get('/:id', asyncHandler(productController.publicGetById));

export { productRouter };
