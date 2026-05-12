import Joi from 'joi';

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const URL_PATTERN = /^https?:\/\/.+/i;

/** Admin: POST /admin/products body. */
export const createProductSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200).required(),
  slug: Joi.string()
    .trim()
    .lowercase()
    .pattern(SLUG_PATTERN)
    .max(120)
    .required(),
  description: Joi.string().trim().allow('').max(5000).default(''),
  price: Joi.number().min(0).precision(2).required(),
  currency: Joi.string().trim().uppercase().length(3).default('USD'),
  stockQty: Joi.number().integer().min(0).default(0),
  images: Joi.array()
    .items(Joi.string().trim().pattern(URL_PATTERN))
    .max(20)
    .default([]),
  category: Joi.string().trim().lowercase().max(60).allow('').default(''),
  isActive: Joi.boolean().default(false),
}).unknown(false);

/** Admin: PATCH /admin/products/:id body. At least one field required. */
export const updateProductSchema = Joi.object({
  name: Joi.string().trim().min(1).max(200),
  slug: Joi.string().trim().lowercase().pattern(SLUG_PATTERN).max(120),
  description: Joi.string().trim().allow('').max(5000),
  price: Joi.number().min(0).precision(2),
  currency: Joi.string().trim().uppercase().length(3),
  stockQty: Joi.number().integer().min(0),
  images: Joi.array().items(Joi.string().trim().pattern(URL_PATTERN)).max(20),
  category: Joi.string().trim().lowercase().max(60).allow(''),
  isActive: Joi.boolean(),
})
  .min(1)
  .unknown(false);

/** Public: GET /products query. No `status` field — admin-only concept. */
export const listPublicProductsQuerySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
  q: Joi.string().trim().allow(''),
  category: Joi.string().trim().lowercase(),
}).unknown(false);

/** Admin: GET /admin/products query. Built from public schema so shared fields can't drift. */
export const listAdminProductsQuerySchema = listPublicProductsQuerySchema.append(
  {
    status: Joi.string().valid('live', 'draft', 'deleted', 'all'),
  },
);
