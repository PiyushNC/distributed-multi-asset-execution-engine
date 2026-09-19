import bcrypt from 'bcrypt';

import { Account } from '../models/Account.js';
import { User } from '../models/User.js';
import type { UserRole } from '../models/User.js';
import { config } from '../config.js';
import { redisConnection } from '../connections.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from './tokenService.js';

const REFRESH_TOKEN_PREFIX = 'refresh-token:';

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function comparePassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

export async function storeRefreshToken(userId: string, refreshToken: string): Promise<void> {
  const key = `${REFRESH_TOKEN_PREFIX}${userId}`;
  await redisConnection.set(key, refreshToken, 'EX', 60 * 60 * 24 * 7);
}

export async function revokeRefreshToken(userId: string): Promise<void> {
  await redisConnection.del(`${REFRESH_TOKEN_PREFIX}${userId}`);
}

export async function validateStoredRefreshToken(userId: string, refreshToken: string): Promise<boolean> {
  const storedToken = await redisConnection.get(`${REFRESH_TOKEN_PREFIX}${userId}`);
  return storedToken === refreshToken;
}

export async function registerUser(email: string, password: string) {
  const existingUser = await User.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    throw new Error('User already exists');
  }

  const hashedPassword = await hashPassword(password);
  const normalizedEmail = email.toLowerCase();
  const role: UserRole = config.adminEmails.includes(normalizedEmail) ? 'ADMIN' : 'USER';
  const user = await User.create({ email: normalizedEmail, password: hashedPassword, role });

  await Account.create({
    userId: user._id,
    assetBalance: { BTC: 1, ETH: 10 },
    quoteBalance: { USD: 100000 },
  });

  const accessToken = signAccessToken(user._id.toString(), user.email, user.role);
  const refreshToken = signRefreshToken(user._id.toString(), user.email, user.role, 1);

  await storeRefreshToken(user._id.toString(), refreshToken);

  return {
    user: { id: user._id.toString(), email: user.email, role: user.role },
    accessToken,
    refreshToken,
  };
}

export async function loginUser(email: string, password: string) {
  const user = await User.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new Error('Invalid credentials');
  }

  const isValid = await comparePassword(password, user.password);
  if (!isValid) {
    throw new Error('Invalid credentials');
  }

  const accessToken = signAccessToken(user._id.toString(), user.email, user.role);
  const refreshToken = signRefreshToken(user._id.toString(), user.email, user.role, 1);

  await storeRefreshToken(user._id.toString(), refreshToken);

  return {
    user: { id: user._id.toString(), email: user.email, role: user.role },
    accessToken,
    refreshToken,
  };
}

export async function refreshUserSession(currentRefreshToken: string) {
  const payload = verifyRefreshToken(currentRefreshToken);
  const user = await User.findById(payload.userId);

  if (!user) {
    throw new Error('User not found');
  }

  const isValid = await validateStoredRefreshToken(user._id.toString(), currentRefreshToken);
  if (!isValid) {
    throw new Error('Refresh token revoked or invalid');
  }

  await revokeRefreshToken(user._id.toString());

  const newRefreshToken = signRefreshToken(user._id.toString(), user.email, user.role, payload.tokenVersion + 1);
  await storeRefreshToken(user._id.toString(), newRefreshToken);

  return {
    accessToken: signAccessToken(user._id.toString(), user.email, user.role),
    refreshToken: newRefreshToken,
  };
}

export function buildRefreshCookie(refreshToken: string): string {
  return `refreshToken=${refreshToken}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 7}; SameSite=Strict; Secure=${process.env.NODE_ENV === 'production' ? 'true' : 'false'}`;
}
