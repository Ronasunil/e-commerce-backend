import { ApiError } from '../utils/ApiError.js';

/**
 * Generic joi validation middleware factory.
 * Pass `target: 'body' | 'query' | 'params'` to validate a different request property (default 'body').
 * On error, throws ApiError(400) with joi's details so errorHandler renders cleanly.
 */
export const validate = (schema, target = 'body') => (req, _res, next) => {
  const { value, error } = schema.validate(req[target], {
    abortEarly: false,
    stripUnknown: false,
    convert: true,
  });
  if (error) {
    return next(
      new ApiError(400, error.details[0]?.message || 'validation failed', {
        details: error.details.map((d) => ({
          path: d.path.join('.'),
          message: d.message,
        })),
      }),
    );
  }
  req[target] = value;
  next();
};
