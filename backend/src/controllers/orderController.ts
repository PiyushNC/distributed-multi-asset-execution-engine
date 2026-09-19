import type { Request, Response } from 'express';
import mongoose from 'mongoose';

import { emitOrderBookUpdate, emitOrderUpdated } from '../config/socket.js';
import { orderQueue } from '../queues/orderQueue.js';
import { Account } from '../models/Account.js';
import { Order } from '../models/Order.js';
import { matchingEngine } from '../matching/engineInstance.js';
import { broadcastHeapTelemetry, broadcastQueueTelemetry } from '../telemetry/telemetryEmitter.js';

export { matchingEngine };

function parsePair(pair: unknown): { normalizedPair: string; baseAsset: string; quoteAsset: string } | null {
  if (typeof pair !== 'string') {
    return null;
  }

  const normalizedPair = pair.trim().toUpperCase();
  const [baseAsset, quoteAsset, ...extraParts] = normalizedPair.split('-');
  if (!baseAsset || !quoteAsset || extraParts.length > 0) {
    return null;
  }

  return { normalizedPair, baseAsset, quoteAsset };
}

function validPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export async function createOrderHandler(request: Request, response: Response): Promise<void> {
  try {
    if (!request.user) {
      response.status(401).json({ message: 'Authentication required' });
      return;
    }

    const { pair, side, price, quantity } = request.body as {
      pair?: unknown;
      side?: unknown;
      price?: unknown;
      quantity?: unknown;
    };
    const parsedPair = parsePair(pair);

    if (
      !parsedPair ||
      (side !== 'BUY' && side !== 'SELL') ||
      !validPositiveNumber(price) ||
      !validPositiveNumber(quantity)
    ) {
      response.status(400).json({
        message: 'pair, side (BUY or SELL), positive price, and positive quantity are required',
      });
      return;
    }

    const userId = new mongoose.Types.ObjectId(request.user.userId);
    const account = await Account.findOne({ userId });
    if (!account) {
      response.status(404).json({ message: 'Trading account not found' });
      return;
    }

    const requiredBalance = side === 'BUY' ? price * quantity : quantity;
    const availableBalance = side === 'BUY'
      ? account.quoteBalance[parsedPair.quoteAsset] ?? 0
      : account.assetBalance[parsedPair.baseAsset] ?? 0;
    if (availableBalance < requiredBalance) {
      response.status(400).json({
        message: `Insufficient ${side === 'BUY' ? parsedPair.quoteAsset : parsedPair.baseAsset} balance`,
      });
      return;
    }

    const order = await Order.create({
      userId,
      pair: parsedPair.normalizedPair,
      side,
      type: 'LIMIT',
      price,
      quantity,
      filledQuantity: 0,
      status: 'PENDING',
    });
    const job = await orderQueue.add(
      'process-order',
      { orderId: order._id.toString() },
      { jobId: order._id.toString() },
    );
    void broadcastQueueTelemetry(orderQueue);

    response.status(202).json({ order, jobId: job.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to place order';
    response.status(500).json({ message });
  }
}

export async function listOrdersHandler(request: Request, response: Response): Promise<void> {
  if (!request.user) {
    response.status(401).json({ message: 'Authentication required' });
    return;
  }

  const orders = await Order.find({ userId: request.user.userId }).sort({ createdAt: -1 });
  response.status(200).json({ orders });
}

export async function cancelOrderHandler(request: Request, response: Response): Promise<void> {
  try {
    if (!request.user) {
      response.status(401).json({ message: 'Authentication required' });
      return;
    }

    if (!mongoose.isValidObjectId(request.params.id)) {
      response.status(400).json({ message: 'Invalid order id' });
      return;
    }

    const order = await Order.findOne({ _id: request.params.id, userId: request.user.userId });
    if (!order) {
      response.status(404).json({ message: 'Order not found' });
      return;
    }
    if (order.status !== 'OPEN' && order.status !== 'PARTIALLY_FILLED') {
      response.status(409).json({ message: 'Only open orders can be cancelled' });
      return;
    }

    const removed = matchingEngine.removeOrder(order.pair, order._id);
    if (!removed) {
      response.status(409).json({ message: 'Order is not active in the matching engine' });
      return;
    }

    order.status = 'CANCELLED';
    await order.save();
    emitOrderUpdated(order.userId.toString(), {
      id: order._id.toString(),
      pair: order.pair,
      side: order.side,
      status: order.status,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
    });
    emitOrderBookUpdate({
      pair: order.pair,
      ...matchingEngine.getTopDepth(order.pair),
    });
    broadcastHeapTelemetry(matchingEngine, order.pair);
    response.status(200).json({ order });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to cancel order';
    response.status(500).json({ message });
  }
}
