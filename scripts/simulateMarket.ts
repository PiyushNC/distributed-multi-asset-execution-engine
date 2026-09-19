import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import mongoose from 'mongoose';

import { Account } from '../backend/src/models/Account.js';
import { User } from '../backend/src/models/User.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(scriptDir, '../backend/.env') });
loadEnv();

const API_URL = process.env.API_URL ?? `http://localhost:${process.env.PORT ?? 4000}`;
const PAIR = 'BTC-USD';
const BOT_COUNT = 10;
const BOT_PASSWORD = 'Bot#Test123!';
const SEED_USD = 1_000_000;
const SEED_BTC = 100;
const ORDER_INTERVAL_MS = 100;

type BotSession = {
  email: string;
  token: string;
  userId: string;
};

type AuthResponse = {
  accessToken?: string;
  user?: { id?: string };
  message?: string;
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomQuantity(): number {
  return Number((Math.random() * 0.04 + 0.01).toFixed(4));
}

async function postJson(pathname: string, body: unknown, token?: string): Promise<{ status: number; data: AuthResponse & { message?: string } }> {
  const response = await fetch(`${API_URL}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as AuthResponse;
  return { status: response.status, data };
}

async function authenticateBot(index: number): Promise<BotSession> {
  const email = `bot${index}@test.com`;
  const register = await postJson('/auth/register', { email, password: BOT_PASSWORD });
  if (register.data.accessToken && register.data.user?.id) {
    console.log(`[BOT] Registered ${email}`);
    return { email, token: register.data.accessToken, userId: register.data.user.id };
  }

  const login = await postJson('/auth/login', { email, password: BOT_PASSWORD });
  if (!login.data.accessToken || !login.data.user?.id) {
    throw new Error(`Failed to register or login ${email}: ${login.data.message ?? register.data.message ?? 'unknown error'}`);
  }

  console.log(`[BOT] Logged in ${email}`);
  return { email, token: login.data.accessToken, userId: login.data.user.id };
}

async function seedBalances(userId: string, email: string): Promise<void> {
  const account = await Account.findOne({ userId });
  if (!account) {
    await Account.create({
      userId,
      assetBalance: { BTC: SEED_BTC },
      quoteBalance: { USD: SEED_USD },
    });
    console.log(`[BOT] Created funded account for ${email}`);
    return;
  }

  account.assetBalance = { ...account.assetBalance, BTC: SEED_BTC };
  account.quoteBalance = { ...account.quoteBalance, USD: SEED_USD };
  account.markModified('assetBalance');
  account.markModified('quoteBalance');
  await account.save();
  console.log(`[BOT] Seeded ${email} with $${SEED_USD.toLocaleString()} USD and ${SEED_BTC} BTC`);
}

async function placeOrder(bot: BotSession, side: 'BUY' | 'SELL', price: number, quantity: number, kind: 'maker' | 'taker'): Promise<void> {
  const { status, data } = await postJson('/api/orders', { pair: PAIR, side, type: 'LIMIT', price, quantity }, bot.token);
  if (status >= 400) {
    console.warn(`[BOT] Order rejected for ${bot.email}: ${data.message ?? status}`);
    return;
  }

  console.log(
    `[BOT] Posted order ${kind.toUpperCase()} ${side} ${quantity} ${PAIR} @ $${price.toLocaleString()} (${bot.email})`,
  );
}

function pickBot(bots: BotSession[]): BotSession {
  return bots[randomInt(0, bots.length - 1)];
}

async function postRestingLiquidity(bots: BotSession[]): Promise<void> {
  const bot = pickBot(bots);
  const side: 'BUY' | 'SELL' = Math.random() < 0.5 ? 'BUY' : 'SELL';
  const price = side === 'BUY' ? randomInt(49_500, 49_999) : randomInt(50_001, 50_500);
  await placeOrder(bot, side, price, randomQuantity(), 'maker');
}

async function postTakerTrade(bots: BotSession[]): Promise<void> {
  const bot = pickBot(bots);
  const side: 'BUY' | 'SELL' = Math.random() < 0.5 ? 'BUY' : 'SELL';
  const price = side === 'BUY' ? 50_001 : 49_999;
  await placeOrder(bot, side, price, randomQuantity(), 'taker');
}

function scheduleTakers(bots: BotSession[]): void {
  const delay = randomInt(1000, 2000);
  setTimeout(() => {
    void postTakerTrade(bots).catch((error: unknown) => {
      console.error('[BOT] Taker trade failed:', error);
    });
    scheduleTakers(bots);
  }, delay);
}

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required to seed bot balances');
  }

  await mongoose.connect(process.env.MONGODB_URI);
  await User.init();
  await Account.init();

  const bots: BotSession[] = [];
  for (let index = 1; index <= BOT_COUNT; index += 1) {
    const bot = await authenticateBot(index);
    await seedBalances(bot.userId, bot.email);
    bots.push(bot);
  }

  console.log(`[BOT] Market maker simulation running against ${API_URL} (${PAIR})`);
  setInterval(() => {
    const roll = Math.random();
    if (roll < 0.8) {
      void postRestingLiquidity(bots).catch((error: unknown) => {
        console.error('[BOT] Maker order failed:', error);
      });
    }
  }, ORDER_INTERVAL_MS);
  scheduleTakers(bots);
}

void main().catch(async (error: unknown) => {
  console.error('[BOT] Simulation failed to start:', error);
  await mongoose.disconnect().catch(() => undefined);
  process.exit(1);
});
