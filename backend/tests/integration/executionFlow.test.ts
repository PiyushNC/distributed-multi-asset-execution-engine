import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';

import { app } from '../../src/app.js';
import { connectInfrastructure, disconnectInfrastructure } from '../../src/connections.js';
import { matchingEngine } from '../../src/matching/engineInstance.js';
import { Account } from '../../src/models/Account.js';
import { Order } from '../../src/models/Order.js';
import { Trade } from '../../src/models/Trade.js';
import { orderQueue } from '../../src/queues/orderQueue.js';
import { startOrderWorker, stopOrderWorker } from '../../src/workers/orderWorker.js';

const TEST_PAIR = 'BTC-USD';
const TEST_EMAIL_SUFFIX = Date.now();

async function waitFor<T>(read: () => Promise<T>, predicate: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15000;
  let value = await read();

  while (!predicate(value) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }

  if (!predicate(value)) {
    throw new Error(`Timed out waiting for condition. Last value: ${JSON.stringify(value)}`);
  }

  return value;
}

describe('execution flow integration', () => {
  let traderAToken: string;
  let traderBToken: string;
  let traderAId: string;
  let traderBId: string;
  let sellOrderId: string;
  let buyOrderId: string;

  beforeAll(async () => {
    await connectInfrastructure();
    await Order.deleteMany({ pair: TEST_PAIR });
    await Trade.deleteMany({ pair: TEST_PAIR });
    await orderQueue.obliterate({ force: true });
    startOrderWorker();

    const traderA = await request(app)
      .post('/auth/register')
      .send({ email: `trader-a-${TEST_EMAIL_SUFFIX}@example.com`, password: 'secret123' })
      .expect(201);
    const traderB = await request(app)
      .post('/auth/register')
      .send({ email: `trader-b-${TEST_EMAIL_SUFFIX}@example.com`, password: 'secret123' })
      .expect(201);

    traderAToken = traderA.body.accessToken;
    traderBToken = traderB.body.accessToken;
    traderAId = traderA.body.user.id;
    traderBId = traderB.body.user.id;

    await Account.updateOne(
      { userId: traderAId },
      { $set: { assetBalance: { BTC: 0 }, quoteBalance: { USD: 100000 } } },
    );
    await Account.updateOne(
      { userId: traderBId },
      { $set: { assetBalance: { BTC: 2 }, quoteBalance: { USD: 0 } } },
    );
  });

  afterAll(async () => {
    await stopOrderWorker();
    await Order.deleteMany({ userId: { $in: [traderAId, traderBId] } });
    await Trade.deleteMany({ pair: TEST_PAIR });
    await disconnectInfrastructure();
  });

  it('processes a queued sell and buy through matching and atomic settlement', async () => {
    const sellResponse = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${traderBToken}`)
      .send({ pair: TEST_PAIR, side: 'SELL', type: 'LIMIT', price: 50000, quantity: 1 })
      .expect(202);

    expect(sellResponse.body.order.status).toBe('PENDING');
    sellOrderId = sellResponse.body.order._id;
    expect(sellResponse.body.jobId).toBeTruthy();

    const sellOrder = await waitFor(
      () => Order.findById(sellOrderId).then((order) => order?.toObject()),
      (order) => order?.status === 'OPEN',
    );
    expect(sellOrder?.status).toBe('OPEN');
    expect(matchingEngine.getBook(TEST_PAIR).asks.map((order) => order._id.toString())).toContain(
      sellOrderId,
    );

    const queuedJob = await orderQueue.getJob(sellResponse.body.jobId);
    expect(queuedJob?.data).toEqual({ orderId: sellOrderId });

    const buyResponse = await request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${traderAToken}`)
      .send({ pair: TEST_PAIR, side: 'BUY', type: 'LIMIT', price: 50000, quantity: 1 })
      .expect(202);

    expect(buyResponse.body.order.status).toBe('PENDING');
    buyOrderId = buyResponse.body.order._id;

    await waitFor(
      () => Order.findById(buyOrderId).then((order) => order?.status),
      (status) => status === 'FILLED',
    );

    const [buyerAccount, sellerAccount, orders, trades] = await Promise.all([
      Account.findOne({ userId: traderAId }).lean(),
      Account.findOne({ userId: traderBId }).lean(),
      Order.find({ _id: { $in: [sellOrderId, buyOrderId] } }).lean(),
      Trade.find({ pair: TEST_PAIR }).lean(),
    ]);

    expect(buyerAccount?.quoteBalance.USD).toBe(50000);
    expect(buyerAccount?.assetBalance.BTC).toBe(1);
    expect(sellerAccount?.assetBalance.BTC).toBe(1);
    expect(sellerAccount?.quoteBalance.USD).toBe(50000);
    expect(orders).toHaveLength(2);
    expect(orders.every((order) => order.status === 'FILLED')).toBe(true);
    expect(orders.every((order) => order.filledQuantity === 1)).toBe(true);
    expect(trades).toHaveLength(1);
    expect(trades[0]).toMatchObject({ pair: TEST_PAIR, price: 50000, quantity: 1 });
  });
});
