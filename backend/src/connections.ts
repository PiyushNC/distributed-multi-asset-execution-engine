import mongoose from 'mongoose';

import { config } from './config.js';
import { redisConnection } from './config/redis.js';
import { orderQueue } from './queues/orderQueue.js';

export { orderQueue, redisConnection };

export async function connectInfrastructure(): Promise<void> {
  await mongoose.connect(config.mongoUri);

  if (redisConnection.status === 'wait') {
    await redisConnection.connect();
  } else if (redisConnection.status !== 'ready') {
    await new Promise<void>((resolve, reject) => {
      redisConnection.once('ready', resolve);
      redisConnection.once('error', reject);
    });
  }
}

export async function disconnectInfrastructure(): Promise<void> {
  await Promise.all([mongoose.disconnect(), redisConnection.quit(), orderQueue.close()]);
}

export function infrastructureStatus(): {
  mongo: string;
  redis: string;
} {
  return {
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
    redis: redisConnection.status === 'ready' ? 'connected' : redisConnection.status,
  };
}
