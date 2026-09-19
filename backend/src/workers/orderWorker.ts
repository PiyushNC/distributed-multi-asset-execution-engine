import { Worker } from 'bullmq';

import { redisConnectionOptions } from '../config/redis.js';
import { emitOrderBookUpdate, emitOrderUpdated } from '../config/socket.js';
import { matchingEngine } from '../matching/engineInstance.js';
import { Order } from '../models/Order.js';
import { orderQueue, ORDER_QUEUE_NAME, type ProcessOrderJob } from '../queues/orderQueue.js';
import { SettlementEngine } from '../services/settlementService.js';
import { broadcastHeapTelemetry, broadcastQueueTelemetry } from '../telemetry/telemetryEmitter.js';

const settlementEngine = new SettlementEngine();
let worker: Worker<ProcessOrderJob> | undefined;

export function startOrderWorker(): Worker<ProcessOrderJob> {
  if (worker) {
    return worker;
  }

  worker = new Worker<ProcessOrderJob>(
    ORDER_QUEUE_NAME,
    async (job) => {
      const order = await Order.findById(job.data.orderId);
      if (!order) {
        throw new Error(`Order ${job.data.orderId} was not found`);
      }

      if (order.status !== 'PENDING') {
        console.log(`Skipping order ${order._id}: status is ${order.status}.`);
        return;
      }

      const result = matchingEngine.processOrder(order);
      if (result.trades.length > 0) {
        await settlementEngine.settleTrades(result.trades);
      } else {
        await order.save();
      }

      emitOrderBookUpdate({
        pair: order.pair,
        ...matchingEngine.getTopDepth(order.pair),
      });
      broadcastHeapTelemetry(matchingEngine, order.pair);
      void broadcastQueueTelemetry(orderQueue);
      if (result.trades.length === 0) {
        emitOrderUpdated(order.userId.toString(), {
          id: order._id.toString(),
          pair: order.pair,
          side: order.side,
          status: order.status,
          quantity: order.quantity,
          filledQuantity: order.filledQuantity,
        });
      }

      console.log(
        `Processed order ${order._id}: ${result.trades.length} trade(s), status ${order.status}.`,
      );
    },
    {
      connection: redisConnectionOptions,
      concurrency: 1,
    },
  );

  worker.on('completed', (job) => {
    console.log(`Order job ${job.id} completed.`);
    void broadcastQueueTelemetry(orderQueue);
  });
  worker.on('failed', (job, error) => {
    console.error(`Order job ${job?.id ?? 'unknown'} failed:`, error);
    void broadcastQueueTelemetry(orderQueue);
  });
  worker.on('error', (error) => {
    console.error('Order worker error:', error);
  });

  return worker;
}

export async function stopOrderWorker(): Promise<void> {
  if (!worker) {
    return;
  }

  await worker.close();
  worker = undefined;
}
