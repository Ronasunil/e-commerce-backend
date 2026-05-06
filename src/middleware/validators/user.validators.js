import Joi from 'joi';

const addressSchema = Joi.object({
  line1: Joi.string().trim().allow('', null),
  city: Joi.string().trim().allow('', null),
  state: Joi.string().trim().allow('', null),
  postalCode: Joi.string().trim().allow('', null),
  country: Joi.string().trim().allow('', null),
}).unknown(false);

/**
 * Strict allowlist for PATCH /users/me.
 * .unknown(false) rejects any field not listed here (including email, username,
 * role, authId, isVerified, deletedAt — those are immutable from this endpoint).
 */
export const updateMeSchema = Joi.object({
  picture: Joi.string().uri().allow(null, ''),
  bio: Joi.string().max(500).allow(null, ''),
  dateOfBirth: Joi.date().allow(null, ''),
  gender: Joi.string()
    .valid('male', 'female', 'other', 'prefer_not_to_say')
    .allow(null, ''),
  phone: Joi.string().min(3).max(32).allow(null, ''),
  address: addressSchema,
})
  .min(1)
  .unknown(false);
