import mongoose from 'mongoose';

import { ApiError } from './ApiError.js';

export const assertObjectId = (id, resourceName) => {
  if (!mongoose.isValidObjectId(id)) {
    throw new ApiError(404, `${resourceName} not found`);
  }
};
