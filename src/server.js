import { app } from './app.js';
import { config } from './config/env.js';
import { connectDb, disconnectDb } from './config/db.js';

const start = async () => {
  await connectDb();

  const server = app.listen(config.port, () => {
    console.log(`Server running on port ${config.port} (${config.nodeEnv})`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down gracefully`);
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled Rejection:', reason);
    server.close(async () => {
      await disconnectDb();
      process.exit(1);
    });
  });

  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
    process.exit(1);
  });
};

start().catch((err) => {
  console.error('Failed to start server:', err.message || err);
  process.exit(1);
});
