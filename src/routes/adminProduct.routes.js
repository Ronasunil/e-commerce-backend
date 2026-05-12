import { Router } from 'express';

import { productController } from '../controllers/product.controller.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireRole } from '../middleware/requireRole.js';
import { validate } from '../middleware/validate.js';
import {
  createProductSchema,
  listAdminProductsQuerySchema,
  updateProductSchema,
} from '../middleware/validators/product.validators.js';

const adminProductRouter = Router();

// Admin-only routes. requireAuth fires first (loud 401/403 on token problems);
// requireRole('admin') gates by role. Both apply to every route below.
adminProductRouter.use(requireAuth, requireRole('admin'));

adminProductRouter.get(
  '/',
  validate(listAdminProductsQuerySchema, 'query'),
  asyncHandler(productController.list),
);

adminProductRouter.get('/:id', asyncHandler(productController.getById));

adminProductRouter.post(
  '/',
  validate(createProductSchema),
  asyncHandler(productController.create),
);

adminProductRouter.patch(
  '/:id',
  validate(updateProductSchema),
  asyncHandler(productController.update),
);

adminProductRouter.delete('/:id', asyncHandler(productController.remove));

adminProductRouter.post(
  '/:id/restore',
  asyncHandler(productController.restore),
);

export { adminProductRouter };
