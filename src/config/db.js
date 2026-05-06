import mongoose from 'mongoose';

import { config } from './env.js';

export const connectDb = async () => {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  const helloRes = await mongoose.connection.db
    .admin()
    .command({ hello: 1 });

  if (!helloRes.setName) {
    throw new Error(
      'Mongo must run in replica-set mode for transactions. ' +
        'Run `docker compose up -d` to start a local replica set ' +
        '(see docker-compose.yml).',
    );
  }

  console.log(
    `Mongo connected (replica set: ${helloRes.setName}, primary: ${helloRes.primary})`,
  );
};

export const disconnectDb = async () => {
  await mongoose.disconnect();
};
