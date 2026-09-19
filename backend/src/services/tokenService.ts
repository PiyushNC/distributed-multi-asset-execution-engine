import jwt from 'jsonwebtoken';

import { config } from '../config.js';
import type { UserRole } from '../models/User.js';

export type AccessTokenPayload = {
  userId: string;
  email: string;
  role: UserRole;
  type: 'access';
};

export type RefreshTokenPayload = {
  userId: string;
  email: string;
  role: UserRole;
  tokenVersion: number;
  type: 'refresh';
};

export function signAccessToken(userId: string, email: string, role: UserRole): string {
  return jwt.sign(
    { userId, email, role, type: 'access' } as AccessTokenPayload,
    config.jwtAccessSecret as jwt.Secret,
    { expiresIn: config.accessTokenTtl as jwt.SignOptions['expiresIn'] },
  );
}

export function signRefreshToken(userId: string, email: string, role: UserRole, tokenVersion: number): string {
  return jwt.sign(
    { userId, email, role, tokenVersion, type: 'refresh' } as RefreshTokenPayload,
    config.jwtRefreshSecret as jwt.Secret,
    { expiresIn: config.refreshTokenTtl as jwt.SignOptions['expiresIn'] },
  );
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, config.jwtAccessSecret) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, config.jwtRefreshSecret) as RefreshTokenPayload;
}
