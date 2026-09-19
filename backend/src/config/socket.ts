import type { Server as HttpServer } from 'node:http';

import { Server, type Socket } from 'socket.io';

import { config } from '../config.js';
import { verifyAccessToken } from '../services/tokenService.js';

export type OrderBookLevel = {
  price: number;
  quantity: number;
  orderCount: number;
};

export type OrderBookUpdate = {
  pair: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
};

let socketServer: Server | undefined;

type AuthenticatedSocket = Socket & {
  data: {
    user?: {
      userId: string;
      email: string;
        role: 'USER' | 'ADMIN';
    };
  };
};

function normalizePair(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const pair = value.trim().toUpperCase();
  return /^[A-Z0-9]+-[A-Z0-9]+$/.test(pair) ? pair : null;
}

function extractToken(socket: Socket): string | undefined {
  const authToken = socket.handshake.auth?.token;
  const authorization = socket.handshake.headers.authorization;
  const rawToken = typeof authToken === 'string'
    ? authToken
    : typeof authorization === 'string'
      ? authorization
      : undefined;

  if (!rawToken) {
    return undefined;
  }

  return rawToken.startsWith('Bearer ') ? rawToken.substring('Bearer '.length).trim() : rawToken;
}

export function initializeSocket(httpServer: HttpServer): Server {
  if (socketServer) {
    return socketServer;
  }

  socketServer = new Server(httpServer, {
    cors: {
      origin: config.frontendUrls,
      credentials: true,
    },
  });

  socketServer.use((socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      next();
      return;
    }

    try {
      const payload = verifyAccessToken(token);
      socket.data.user = {
        userId: payload.userId,
        email: payload.email,
        role: payload.role === 'ADMIN' ? 'ADMIN' : 'USER',
      };
      next();
    } catch {
      next(new Error('Invalid or expired access token'));
    }
  });

  socketServer.on('connection', (rawSocket) => {
    const socket = rawSocket as AuthenticatedSocket;
    const user = socket.data.user;

    if (user) {
      socket.join(`user:${user.userId}`);
      if (user.role === 'ADMIN') {
        void socket.join('admin:telemetry');
      }
      socket.on('admin:join', () => {
        if (user.role === 'ADMIN') void socket.join('admin:telemetry');
      });
      socket.on('admin:test-rollback', () => {
        if (user.role !== 'ADMIN') return;
        const sessionID = `forced-${Date.now()}`;
        socketServer?.to('admin:telemetry').emit('telemetry:tx', {
          sessionId: sessionID,
          sessionID,
          durationMs: 0,
          status: 'ROLLED_BACK',
          error: 'Forced rollback test requested by administrator',
          timestamp: new Date().toISOString(),
        });
        socket.emit('admin:rollback:result', { ok: true, message: 'Forced rollback telemetry emitted.' });
      });
    }

    socket.use(([, ...eventArguments], next) => {
      if (eventArguments.some((argument) => argument && typeof argument === 'object' && 'userId' in argument)) {
        next(new Error('Private user events are server-only'));
        return;
      }
      next();
    });

    socket.on('market:join', (value: unknown) => {
      const pair = normalizePair(typeof value === 'object' && value !== null && 'pair' in value
        ? (value as { pair?: unknown }).pair
        : value);
      if (pair) {
        void socket.join(`market:${pair}`);
      }
    });

    socket.on('market:leave', (value: unknown) => {
      const pair = normalizePair(typeof value === 'object' && value !== null && 'pair' in value
        ? (value as { pair?: unknown }).pair
        : value);
      if (pair) {
        void socket.leave(`market:${pair}`);
      }
    });
  });

  return socketServer;
}

function getSocketServer(): Server | undefined {
  return socketServer;
}

export function emitOrderBookUpdate(update: Omit<OrderBookUpdate, 'timestamp'>): void {
  getSocketServer()?.to(`market:${update.pair}`).emit('orderbook:update', {
    ...update,
    timestamp: new Date().toISOString(),
  });
}

export function emitTradeExecuted(trade: {
  pair: string;
  price: number;
  quantity: number;
}): void {
  getSocketServer()?.to(`market:${trade.pair}`).emit('trade:executed', {
    pair: trade.pair,
    price: trade.price,
    quantity: trade.quantity,
    timestamp: new Date().toISOString(),
  });
}

export function emitOrderUpdated(userId: string, order: {
  id: string;
  pair: string;
  side: string;
  status: string;
  quantity: number;
  filledQuantity: number;
}): void {
  getSocketServer()?.to(`user:${userId}`).emit('order:updated', order);
}

export function emitBalanceUpdated(userId: string, balance: {
  assetBalance: Record<string, number>;
  quoteBalance: Record<string, number>;
}): void {
  getSocketServer()?.to(`user:${userId}`).emit('balance:updated', balance);
}

export function emitAdminTelemetry(event: string, payload: unknown): void {
  getSocketServer()?.to('admin:telemetry').emit(event, payload);
}

export async function closeSocketServer(): Promise<void> {
  if (!socketServer) {
    return;
  }

  await new Promise<void>((resolve) => {
    socketServer?.close(() => resolve());
  });
  socketServer = undefined;
}
