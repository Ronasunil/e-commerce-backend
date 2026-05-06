import { Router } from 'express';

import { productRouter } from './product.routes.js';
import { userRouter } from './user.routes.js';
import { orderRouter } from './order.routes.js';
import { authRouter } from './auth.routes.js';

const apiRouter = Router();

apiRouter.use('/auth', authRouter);
apiRouter.use('/users', userRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/orders', orderRouter);

export { apiRouter };
