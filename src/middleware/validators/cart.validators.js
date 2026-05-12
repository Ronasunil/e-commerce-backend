import Joi from 'joi';

/** POST /cart/items body. */
export const addItemBodySchema = Joi.object({
  productId: Joi.string().required(),
  quantity: Joi.number().integer().min(1).max(999).default(1),
}).unknown(false);

/** PATCH /cart/items/:productId body. Absolute quantity, min 1; use DELETE to remove. */
export const updateItemBodySchema = Joi.object({
  quantity: Joi.number().integer().min(1).max(999).required(),
}).unknown(false);
