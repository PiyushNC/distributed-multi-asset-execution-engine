import mongoose from 'mongoose';

import {
  emitBalanceUpdated,
  emitOrderUpdated,
  emitTradeExecuted,
} from '../config/socket.js';
import type { ExecutedTrade } from '../matching/MatchingEngine.js';
import { Account } from '../models/Account.js';
import { Order } from '../models/Order.js';
import { Trade } from '../models/Trade.js';
import { emitTransactionTelemetry } from '../telemetry/telemetryEmitter.js';

type BalanceDelta = {
  asset: Record<string, number>;
  quote: Record<string, number>;
};

function splitPair(pair: string): { baseAsset: string; quoteAsset: string } {
  const [baseAsset, quoteAsset, ...extraParts] = pair.split('-');
  if (!baseAsset || !quoteAsset || extraParts.length > 0) {
    throw new Error(`Invalid trading pair: ${pair}`);
  }

  return { baseAsset, quoteAsset };
}

function addDelta(
  deltas: Map<string, BalanceDelta>,
  userId: mongoose.Types.ObjectId,
  balanceType: 'asset' | 'quote',
  currency: string,
  amount: number,
): void {
  const key = userId.toString();
  const current = deltas.get(key) ?? { asset: {}, quote: {} };
  current[balanceType][currency] = (current[balanceType][currency] ?? 0) + amount;
  deltas.set(key, current);
}

function applyDelta(
  balance: Record<string, number>,
  currency: string,
  amount: number,
  balanceType: string,
  userId: string,
): void {
  const nextValue = (balance[currency] ?? 0) + amount;
  if (nextValue < 0) {
    throw new Error(`Insufficient ${balanceType} balance for user ${userId}`);
  }

  balance[currency] = nextValue;
}

export class SettlementEngine {
  public async settleTrades(trades: ExecutedTrade[]): Promise<void> {
    if (trades.length === 0) {
      return;
    }

    const session = await mongoose.startSession();
    const startedAt = Date.now();
    const updatedOrders: Array<{
      userId: string;
      id: string;
      pair: string;
      side: string;
      status: string;
      quantity: number;
      filledQuantity: number;
    }> = [];
    const updatedBalances: Array<{
      userId: string;
      assetBalance: Record<string, number>;
      quoteBalance: Record<string, number>;
    }> = [];

    try {
      await session.withTransaction(async () => {
        const orderIds = [...new Set(
          trades.flatMap((trade) => [trade.buyOrderId.toString(), trade.sellOrderId.toString()]),
        )].map((orderId) => new mongoose.Types.ObjectId(orderId));
        const orders = await Order.find({ _id: { $in: orderIds } }).session(session);
        const ordersById = new Map(orders.map((order) => [order._id.toString(), order]));
        const fillQuantities = new Map<string, number>();
        const balanceDeltas = new Map<string, BalanceDelta>();
        const tradeDocuments = [];

        for (const trade of trades) {
          const buyOrder = ordersById.get(trade.buyOrderId.toString());
          const sellOrder = ordersById.get(trade.sellOrderId.toString());
          if (!buyOrder || !sellOrder) {
            throw new Error('Cannot settle a trade for an order that does not exist');
          }
          if (buyOrder.side !== 'BUY' || sellOrder.side !== 'SELL') {
            throw new Error('Trade references invalid order sides');
          }
          if (buyOrder.pair !== trade.pair || sellOrder.pair !== trade.pair) {
            throw new Error('Trade pair does not match both orders');
          }
          if (!Number.isFinite(trade.price) || !Number.isFinite(trade.quantity) || trade.quantity <= 0) {
            throw new Error('Trade price and quantity must be positive numbers');
          }

          const { baseAsset, quoteAsset } = splitPair(trade.pair);
          const quoteAmount = trade.price * trade.quantity;
          addDelta(balanceDeltas, buyOrder.userId, 'quote', quoteAsset, -quoteAmount);
          addDelta(balanceDeltas, sellOrder.userId, 'quote', quoteAsset, quoteAmount);
          addDelta(balanceDeltas, buyOrder.userId, 'asset', baseAsset, trade.quantity);
          addDelta(balanceDeltas, sellOrder.userId, 'asset', baseAsset, -trade.quantity);
          fillQuantities.set(
            buyOrder._id.toString(),
            (fillQuantities.get(buyOrder._id.toString()) ?? 0) + trade.quantity,
          );
          fillQuantities.set(
            sellOrder._id.toString(),
            (fillQuantities.get(sellOrder._id.toString()) ?? 0) + trade.quantity,
          );
          tradeDocuments.push({
            buyOrderId: trade.buyOrderId,
            sellOrderId: trade.sellOrderId,
            pair: trade.pair,
            price: trade.price,
            quantity: trade.quantity,
          });
        }

        const userIds = [...balanceDeltas.keys()].map((userId) => new mongoose.Types.ObjectId(userId));
        const accounts = await Account.find({ userId: { $in: userIds } }).session(session);
        const accountsByUserId = new Map(accounts.map((account) => [account.userId.toString(), account]));

        for (const [userId, delta] of balanceDeltas) {
          const account = accountsByUserId.get(userId);
          if (!account) {
            throw new Error(`Account not found for user ${userId}`);
          }

          for (const [currency, amount] of Object.entries(delta.asset)) {
            applyDelta(account.assetBalance, currency, amount, 'asset', userId);
          }
          for (const [currency, amount] of Object.entries(delta.quote)) {
            applyDelta(account.quoteBalance, currency, amount, 'quote', userId);
          }
        }

        for (const account of accounts) {
          account.markModified('assetBalance');
          account.markModified('quoteBalance');
          await account.save({ session });
          updatedBalances.push({
            userId: account.userId.toString(),
            assetBalance: { ...account.assetBalance },
            quoteBalance: { ...account.quoteBalance },
          });
        }

        for (const [orderId, fillQuantity] of fillQuantities) {
          const order = ordersById.get(orderId);
          if (!order) {
            throw new Error(`Order ${orderId} disappeared during settlement`);
          }

          order.filledQuantity += fillQuantity;
          order.status = order.filledQuantity >= order.quantity ? 'FILLED' : 'PARTIALLY_FILLED';
          await order.save({ session });
          updatedOrders.push({
            userId: order.userId.toString(),
            id: order._id.toString(),
            pair: order.pair,
            side: order.side,
            status: order.status,
            quantity: order.quantity,
            filledQuantity: order.filledQuantity,
          });
        }

        await Trade.create(tradeDocuments, { session });
      });

      emitTransactionTelemetry({
        sessionID: session.id?.id?.toString('hex') ?? 'unknown',
        durationMs: Date.now() - startedAt,
        status: 'COMMITTED',
      });

      for (const trade of trades) {
        emitTradeExecuted(trade);
      }
      for (const order of updatedOrders) {
        emitOrderUpdated(order.userId, order);
      }
      for (const balance of updatedBalances) {
        emitBalanceUpdated(balance.userId, balance);
      }
    } catch (error) {
      emitTransactionTelemetry({
        sessionID: session.id?.id?.toString('hex') ?? 'unknown',
        durationMs: Date.now() - startedAt,
        status: 'ROLLED_BACK',
        error: error instanceof Error ? error.message : 'Settlement failed',
      });
      throw error;
    } finally {
      await session.endSession();
    }
  }
}
