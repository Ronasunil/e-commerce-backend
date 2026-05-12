import { ApiError } from '../utils/ApiError.js';
import { isProduction } from '../config/env.js';

export const errorHandler = (err, req, res, next) => {
  const status = err instanceof ApiError ? err.status : 500;
  const message = err.message || 'Internal Server Error';

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    error: {
      message,
      ...(err.details && { details: err.details }),
      ...(!isProduction && { stack: err.stack }),
    },
  });
};
