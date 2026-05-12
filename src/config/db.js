import mongoose from 'mongoose';

import { config } from './env.js';

export const connectDb = async () => {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 5000,
  });

  console.log('Mongo connected');
};

// Boot-time probe: warn loudly on a misconfigured replica set, but continue
// startup. Multi-collection transactions (auth register, setAccountStatus)
// silently degrade to non-atomic writes without a replica set.
export const probeReplicaSet = async () => {
  try {
    const status = await mongoose.connection.db
      .admin()
      .command({ replSetGetStatus: 1 });
    console.log(
      `Mongo replica set OK (name: ${status.set}, members: ${status.members?.length ?? '?'})`,
    );
  } catch (err) {
    console.warn(
      '[WARN] Mongo replica-set probe failed. Transactions will silently ' +
        'degrade to non-atomic writes; auth register and setAccountStatus ' +
        'can leave partial state on failure. ' +
        'Run `docker compose up -d` for a local replica set. ' +
        `(${err?.message || err})`,
    );
  }
};

export const disconnectDb = async () => {
  await mongoose.disconnect();
};

export const isDbHealthy = () => mongoose.connection.readyState === 1;
