import Joi from 'joi';

const email = Joi.string().email().lowercase().trim().required();
const username = Joi.string()
  .pattern(/^[a-zA-Z0-9_]{3,30}$/)
  .lowercase()
  .trim()
  .required();
const password = Joi.string().min(8).max(128).required();

export const registerSchema = Joi.object({
  email,
  username,
  password,
}).unknown(false);

export const loginSchema = Joi.object({
  emailOrUsername: Joi.string().lowercase().trim().min(3).max(254).required(),
  password: Joi.string().min(1).max(128).required(),
}).unknown(false);

export const otpSchema = Joi.object({
  authId: Joi.string().hex().length(24).required(),
  otp: Joi.string().pattern(/^\d{4,6}$/).required(),
}).unknown(false);

export const resendOtpSchema = Joi.object({
  authId: Joi.string().hex().length(24).required(),
}).unknown(false);

export const forgotPasswordSchema = Joi.object({
  email,
}).unknown(false);

export const resetPasswordSchema = Joi.object({
  token: Joi.string().hex().min(32).max(128).required(),
  newPassword: password,
}).unknown(false);

export const changePasswordSchema = Joi.object({
  currentPassword: Joi.string().min(1).max(128).required(),
  newPassword: password,
}).unknown(false);
