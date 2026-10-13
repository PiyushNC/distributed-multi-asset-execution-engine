import mongoose from 'mongoose';

import type { IOrder, OrderSide, OrderType } from '../models/Order.js';
import { MatchingEngine } from './MatchingEngine.js';

function createOrder(
  side: OrderSide,
  price: number,
  quantity: number,
  createdAt: string,
  overrides: Partial<IOrder> = {},
): IOrder {
  return {
    _id: new mongoose.Types.ObjectId(),
    userId: new mongoose.Types.ObjectId(),
    pair: 'BTC-USD',
    side,
    type: 'LIMIT' as OrderType,
    price,
    quantity,
    filledQuantity: 0,
    status: 'OPEN',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    ...overrides,
  };
}

function createMarketOrder(side: OrderSide, quantity: number, createdAt: string): IOrder {
  return createOrder(
    side,
    side === 'BUY' ? Number.MAX_SAFE_INTEGER : 0,
    quantity,
    createdAt,
    { type: 'MARKET' as OrderType },
  );
}

describe('MatchingEngine', () => {
  // ──────────────── Existing tests ────────────────

  it('fully matches a buy order against a sell order at the resting sell price', () => {
    const engine = new MatchingEngine();
    const sellOrder = createOrder('SELL', 100, 2, '2026-01-01T00:00:00.000Z');
    const buyOrder = createOrder('BUY', 105, 2, '2026-01-01T00:01:00.000Z');

    engine.processOrder(sellOrder);
    const result = engine.processOrder(buyOrder);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({
      buyOrderId: buyOrder._id,
      sellOrderId: sellOrder._id,
      pair: 'BTC-USD',
      price: 100,
      quantity: 2,
    });
    expect(result.order.status).toBe('FILLED');
    expect(result.order.filledQuantity).toBe(2);
    expect(sellOrder.status).toBe('FILLED');
    expect(engine.getBook('BTC-USD')).toEqual({ bids: [], asks: [] });
  });

  it('partially matches and rests the incoming order remainder', () => {
    const engine = new MatchingEngine();
    const sellOrder = createOrder('SELL', 100, 2, '2026-01-01T00:00:00.000Z');
    const buyOrder = createOrder('BUY', 100, 5, '2026-01-01T00:01:00.000Z');

    engine.processOrder(sellOrder);
    const result = engine.processOrder(buyOrder);

    expect(result.trades[0]).toMatchObject({ quantity: 2, price: 100 });
    expect(result.order.filledQuantity).toBe(2);
    expect(result.order.status).toBe('PARTIALLY_FILLED');
    expect(engine.getBook('BTC-USD').bids).toEqual([buyOrder]);
  });

  it('does not match non-crossing prices and rests the order', () => {
    const engine = new MatchingEngine();
    const sellOrder = createOrder('SELL', 105, 1, '2026-01-01T00:00:00.000Z');
    const buyOrder = createOrder('BUY', 100, 1, '2026-01-01T00:01:00.000Z');

    engine.processOrder(sellOrder);
    const result = engine.processOrder(buyOrder);

    expect(result.trades).toEqual([]);
    expect(result.order.status).toBe('OPEN');
    expect(engine.getBook('BTC-USD')).toEqual({
      bids: [buyOrder],
      asks: [sellOrder],
    });
  });

  it('uses FIFO ordering for sell orders at the same price', () => {
    const engine = new MatchingEngine();
    const olderSell = createOrder('SELL', 100, 1, '2026-01-01T00:00:00.000Z');
    const newerSell = createOrder('SELL', 100, 1, '2026-01-01T00:01:00.000Z');
    const buyOrder = createOrder('BUY', 100, 1, '2026-01-01T00:02:00.000Z');

    engine.processOrder(olderSell);
    engine.processOrder(newerSell);
    const result = engine.processOrder(buyOrder);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].sellOrderId).toBe(olderSell._id);
    expect(newerSell.status).toBe('OPEN');
    expect(engine.getBook('BTC-USD').asks).toEqual([newerSell]);
  });

  it('exposes the top five max-heap bids and min-heap asks', () => {
    const engine = new MatchingEngine();
    for (let price = 96; price <= 100; price += 1) {
      engine.processOrder(createOrder('BUY', price, 1, `2026-01-01T00:00:0${price - 96}.000Z`));
    }
    for (let price = 101; price <= 105; price += 1) {
      engine.processOrder(createOrder('SELL', price, 1, `2026-01-01T00:01:0${price - 101}.000Z`));
    }

    const snapshot = engine.getHeapSnapshot('BTC-USD', 5);
    expect(snapshot.bids.map((level) => level.price)).toEqual([100, 99, 98, 97, 96]);
    expect(snapshot.asks.map((level) => level.price)).toEqual([101, 102, 103, 104, 105]);
  });

  // ──────────────── New tests: market orders ────────────────

  it('market BUY fills immediately against best ask', () => {
    const engine = new MatchingEngine();
    const sellOrder = createOrder('SELL', 200, 3, '2026-01-01T00:00:00.000Z');
    const marketBuy = createMarketOrder('BUY', 2, '2026-01-01T00:01:00.000Z');

    engine.processOrder(sellOrder);
    const result = engine.processOrder(marketBuy);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ price: 200, quantity: 2 });
    expect(result.order.status).toBe('FILLED');
    expect(result.order.filledQuantity).toBe(2);
    // resting sell should still have 1 remaining
    expect(sellOrder.filledQuantity).toBe(2);
    expect(sellOrder.status).toBe('PARTIALLY_FILLED');
  });

  it('market SELL fills immediately against best bid', () => {
    const engine = new MatchingEngine();
    const buyOrder = createOrder('BUY', 300, 5, '2026-01-01T00:00:00.000Z');
    const marketSell = createMarketOrder('SELL', 3, '2026-01-01T00:01:00.000Z');

    engine.processOrder(buyOrder);
    const result = engine.processOrder(marketSell);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]).toMatchObject({ price: 300, quantity: 3 });
    expect(result.order.status).toBe('FILLED');
    expect(result.order.filledQuantity).toBe(3);
  });

  it('market order with no liquidity adds no trades and does not rest', () => {
    const engine = new MatchingEngine();
    const marketBuy = createMarketOrder('BUY', 1, '2026-01-01T00:00:00.000Z');

    const result = engine.processOrder(marketBuy);

    // No asks → market order cannot fill; it rests in the book (edge case for no-liquidity)
    expect(result.trades).toHaveLength(0);
  });

  // ──────────────── New tests: cancel order ────────────────

  it('removeOrder removes a bid from the book', () => {
    const engine = new MatchingEngine();
    const buyOrder = createOrder('BUY', 99, 1, '2026-01-01T00:00:00.000Z');
    engine.processOrder(buyOrder);

    const removed = engine.removeOrder('BTC-USD', buyOrder._id);

    expect(removed).toBe(true);
    expect(engine.getBook('BTC-USD').bids).toEqual([]);
  });

  it('removeOrder removes an ask from the book', () => {
    const engine = new MatchingEngine();
    const sellOrder = createOrder('SELL', 101, 1, '2026-01-01T00:00:00.000Z');
    engine.processOrder(sellOrder);

    const removed = engine.removeOrder('BTC-USD', sellOrder._id);

    expect(removed).toBe(true);
    expect(engine.getBook('BTC-USD').asks).toEqual([]);
  });

  it('removeOrder returns false for an unknown order id', () => {
    const engine = new MatchingEngine();
    const removed = engine.removeOrder('BTC-USD', new mongoose.Types.ObjectId());
    expect(removed).toBe(false);
  });

  // ──────────────── New tests: multi-pair isolation ────────────────

  it('orders on different pairs do not interact', () => {
    const engine = new MatchingEngine();
    const btcSell = { ...createOrder('SELL', 100, 1, '2026-01-01T00:00:00.000Z'), pair: 'BTC-USD' };
    const ethBuy = { ...createOrder('BUY', 200, 1, '2026-01-01T00:01:00.000Z'), pair: 'ETH-USD' };

    engine.processOrder(btcSell);
    const result = engine.processOrder(ethBuy);

    expect(result.trades).toHaveLength(0);
    expect(engine.getBook('BTC-USD').asks).toHaveLength(1);
    expect(engine.getBook('ETH-USD').bids).toHaveLength(1);
  });

  // ──────────────── New tests: FIFO for bids ────────────────

  it('uses FIFO ordering for buy orders at the same price', () => {
    const engine = new MatchingEngine();
    const olderBuy = createOrder('BUY', 100, 1, '2026-01-01T00:00:00.000Z');
    const newerBuy = createOrder('BUY', 100, 1, '2026-01-01T00:01:00.000Z');
    const sellOrder = createOrder('SELL', 100, 1, '2026-01-01T00:02:00.000Z');

    engine.processOrder(olderBuy);
    engine.processOrder(newerBuy);
    const result = engine.processOrder(sellOrder);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].buyOrderId).toBe(olderBuy._id);
    expect(newerBuy.status).toBe('OPEN');
  });

  // ──────────────── New tests: full fill from partial ────────────────

  it('second fill completes a PARTIALLY_FILLED order to FILLED', () => {
    const engine = new MatchingEngine();
    const sellA = createOrder('SELL', 100, 2, '2026-01-01T00:00:00.000Z');
    const sellB = createOrder('SELL', 100, 3, '2026-01-01T00:00:01.000Z');
    const bigBuy = createOrder('BUY', 100, 5, '2026-01-01T00:01:00.000Z');

    engine.processOrder(sellA);
    engine.processOrder(sellB);
    const result = engine.processOrder(bigBuy);

    expect(result.trades).toHaveLength(2);
    expect(result.order.status).toBe('FILLED');
    expect(result.order.filledQuantity).toBe(5);
    expect(engine.getBook('BTC-USD')).toEqual({ bids: [], asks: [] });
  });
});
