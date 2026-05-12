import { Router } from 'express';

import { adminProductRouter } from './adminProduct.routes.js';
import { authRouter } from './auth.routes.js';
import { cartRouter } from './cart.routes.js';
import { productRouter } from './product.routes.js';
import { userRouter } from './user.routes.js';

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/admin/products', adminProductRouter);
apiRouter.use('/cart', cartRouter);

export { apiRouter };
