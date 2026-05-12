import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';

import { config, isDevelopment } from './config/env.js';
import { isDbHealthy } from './config/db.js';
import { apiRouter } from './routes/index.js';
import { authLimiter } from './middleware/rateLimiters.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

if (config.trustProxy > 0) {
  app.set('trust proxy', config.trustProxy);
}

app.use(helmet());
app.use(cors({ origin: config.corsOrigin }));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(morgan(isDevelopment ? 'dev' : 'combined'));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/ready', (req, res) => {
  if (!isDbHealthy()) {
    return res.status(503).json({
      status: 'unhealthy',
      db: 'down',
      timestamp: new Date().toISOString(),
    });
  }
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/v1/auth', authLimiter);
app.use('/api/v1', apiRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };
