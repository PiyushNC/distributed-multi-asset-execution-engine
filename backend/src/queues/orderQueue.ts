import { Queue } from 'bullmq';

import { redisConnection } from '../config/redis.js';

export const ORDER_QUEUE_NAME = process.env.ORDER_QUEUE_NAME ?? 'order-queue';

export type ProcessOrderJob = {
  orderId: string;
};

export const orderQueue = new Queue<ProcessOrderJob>(ORDER_QUEUE_NAME, {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
});
