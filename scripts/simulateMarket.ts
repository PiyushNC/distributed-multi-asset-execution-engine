import 'dotenv/config';

import bcrypt from 'bcrypt';
import mongoose from 'mongoose';

const API_URL = process.env.SIM_API_URL ?? 'http://localhost:4000';
const MONGODB_URI = process.env.MONGODB_URI ?? 'mongodb://localhost:27017/execution_engine?replicaSet=rs0';
const BOT_COUNT = Number(process.env.SIM_BOT_COUNT ?? 10);
const BOT_PASSWORD = process.env.SIM_BOT_PASSWORD ?? 'BotPass123!';

// SIM_INTENSITY: 1 = light (200ms), 2 = normal (100ms), 3 = heavy (50ms)
const intensity = Math.max(1, Math.min(3, Number(process.env.SIM_INTENSITY ?? 2)));
const MAKER_INTERVAL = intensity === 1 ? 200 : intensity === 3 ? 50 : 100;
const TAKER_INTERVAL_MIN = intensity === 1 ? 2000 : intensity === 3 ? 500 : 1000;
const TAKER_INTERVAL_MAX = intensity === 1 ? 4000 : intensity === 3 ? 1000 : 2000;
const ORDER_LIFETIME_MS = 25000;

type Bot = { email: string; token: string; userId: string };

interface PairConfig {
  pair: string;
  basePrice: number;
  spread: number;
  baseAssetSeed: string;
  quantity: { min: number; max: number };
}

const PAIR_CONFIGS: PairConfig[] = [
  { pair: 'BTC-USD', basePrice: 50000, spread: 500,  baseAssetSeed: 'BTC', quantity: { min: 0.005, max: 0.08 } },
  { pair: 'ETH-USD', basePrice: 3200,  spread: 30,   baseAssetSeed: 'ETH', quantity: { min: 0.05,  max: 0.5  } },
  { pair: 'SOL-USD', basePrice: 145,   spread: 1.5,  baseAssetSeed: 'SOL', quantity: { min: 1,     max: 20   } },
];

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function log(color: keyof typeof colors, message: string): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomDelay(min: number, max: number): number {
  return Math.floor(randomBetween(min, max));
}

async function requestJson<T>(url: string, options: RequestInit): Promise<{ response: Response; data: T }> {
  const response = await fetch(url, options);
  const data = await response.json() as T;
  return { response, data };
}

async function registerBot(index: number): Promise<Bot> {
  const email = `simbot${index}@sim.local`;
  const registration = await requestJson<{ user?: { id?: string }; message?: string }>(`${API_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: BOT_PASSWORD }),
  });
  if (!registration.response.ok && registration.response.status !== 400) {
    throw new Error(`Could not register ${email}: ${registration.data.message ?? registration.response.statusText}`);
  }

  const loginBot = () => requestJson<{ accessToken?: string; user?: { id?: string }; message?: string }>(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: BOT_PASSWORD }),
  });
  let login = await loginBot();
  if (!login.response.ok && login.data.message === 'Invalid credentials') {
    const passwordHash = await bcrypt.hash(BOT_PASSWORD, 12);
    await mongoose.connection.collection('users').updateOne(
      { email },
      { $set: { password: passwordHash } },
    );
    log('yellow', `[SIM] Reset stale credentials for ${email}`);
    login = await loginBot();
  }
  if (!login.response.ok || !login.data.accessToken || !login.data.user?.id) {
    throw new Error(`Could not log in ${email}: ${login.data.message ?? login.response.statusText}`);
  }

  // Generous seed so bots never run out of funds across all pairs
  const accountCollection = mongoose.connection.collection('accounts');
  await accountCollection.updateOne(
    { userId: new mongoose.Types.ObjectId(login.data.user.id) },
    {
      $set: {
        assetBalance: { BTC: 500, ETH: 5000, SOL: 100000 },
        quoteBalance: { USD: 10000000 },
      },
    },
  );
  return { email, token: login.data.accessToken, userId: login.data.user.id };
}

const activeOrders = new Map<string, { token: string; createdAt: number }>();

async function placeOrder(
  bot: Bot,
  config: PairConfig,
  side: 'BUY' | 'SELL',
  price: number,
  quantity: number,
): Promise<void> {
  const { response, data } = await requestJson<{ order?: { _id?: string }; message?: string }>(`${API_URL}/api/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${bot.token}`,
    },
    body: JSON.stringify({ pair: config.pair, side, price, quantity }),
  });
  if (!response.ok) {
    log('yellow', `[BOT] ${config.pair} ${side} rejected: ${data.message ?? response.statusText}`);
    return;
  }

  if (data.order?._id) {
    activeOrders.set(data.order._id, { token: bot.token, createdAt: Date.now() });
  }
  const color = side === 'BUY' ? 'green' : 'red';
  log(color, `[BOT] ${config.pair} ${side} ${quantity.toFixed(4)} @ $${price.toFixed(2)}`);
}

async function createMakerOrder(bots: Bot[], config: PairConfig): Promise<void> {
  if (bots.length === 0) return;
  const bot = bots[Math.floor(Math.random() * bots.length)];
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  const halfSpread = config.spread / 2;
  const price = side === 'BUY'
    ? randomBetween(config.basePrice - config.spread, config.basePrice - halfSpread * 0.1)
    : randomBetween(config.basePrice + halfSpread * 0.1, config.basePrice + config.spread);
  const quantity = randomBetween(config.quantity.min, config.quantity.max);
  await placeOrder(bot, config, side, Number(price.toFixed(2)), Number(quantity.toFixed(6)));
}

async function createTakerOrder(bots: Bot[], config: PairConfig): Promise<void> {
  if (bots.length === 0) return;
  const bot = bots[Math.floor(Math.random() * bots.length)];
  const side = Math.random() > 0.5 ? 'BUY' : 'SELL';
  // Aggressive crossing price
  const price = side === 'BUY'
    ? config.basePrice + config.spread * 1.5
    : config.basePrice - config.spread * 1.5;
  const quantity = randomBetween(config.quantity.min * 2, config.quantity.max * 2);
  await placeOrder(bot, config, side, Number(price.toFixed(2)), Number(quantity.toFixed(6)));
}

async function cleanupStaleOrders(): Promise<void> {
  const now = Date.now();
  const staleIds = [...activeOrders.entries()]
    .filter(([, order]) => now - order.createdAt >= ORDER_LIFETIME_MS)
    .map(([id]) => id);

  await Promise.allSettled(staleIds.map(async (orderId) => {
    const order = activeOrders.get(orderId);
    if (!order) return;
    const response = await fetch(`${API_URL}/api/orders/${orderId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${order.token}` },
    });
    if (response.ok || response.status === 404 || response.status === 409) {
      activeOrders.delete(orderId);
    }
  }));
}

async function start(): Promise<void> {
  await mongoose.connect(MONGODB_URI);
  log('cyan', `[SIM] Connected to MongoDB. API: ${API_URL}. Intensity: ${intensity}. Pairs: ${PAIR_CONFIGS.map((c) => c.pair).join(', ')}`);

  const bots: Bot[] = [];
  for (let index = 1; index <= BOT_COUNT; index += 1) {
    bots.push(await registerBot(index));
  }
  log('cyan', `[SIM] Seeded and logged in ${bots.length} bots`);

  let stopped = false;
  const intervals: ReturnType<typeof setInterval>[] = [];

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    log('magenta', '[SIM] Stopping — cleaning up stale orders...');
    for (const interval of intervals) clearInterval(interval);
    await cleanupStaleOrders();
    await mongoose.disconnect();
    log('magenta', '[SIM] Shutdown complete.');
    process.exit(0);
  };

  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());

  // One maker loop and one taker loop per pair
  for (const config of PAIR_CONFIGS) {
    const makerInterval = setInterval(() => {
      if (stopped) return;
      void createMakerOrder(bots, config);
    }, MAKER_INTERVAL + randomDelay(0, MAKER_INTERVAL / 2));

    const takerInterval = setInterval(() => {
      if (stopped) return;
      void createTakerOrder(bots, config);
    }, randomDelay(TAKER_INTERVAL_MIN, TAKER_INTERVAL_MAX));

    intervals.push(makerInterval, takerInterval);
  }

  const cleanupInterval = setInterval(() => void cleanupStaleOrders(), 5000);
  intervals.push(cleanupInterval);

  log('cyan', `[SIM] Market simulation running. Press Ctrl+C to stop.`);
}

start().catch(async (error: unknown) => {
  console.error('[sim] failed:', error);
  await mongoose.disconnect();
  process.exitCode = 1;
});
