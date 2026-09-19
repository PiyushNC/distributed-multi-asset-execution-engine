import mongoose from 'mongoose';

import type { IOrder, OrderSide } from '../models/Order.js';
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
    type: 'LIMIT',
    price,
    quantity,
    filledQuantity: 0,
    status: 'OPEN',
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    ...overrides,
  };
}

describe('MatchingEngine', () => {
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
});
