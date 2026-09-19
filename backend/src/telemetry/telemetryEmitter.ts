import type { Queue } from 'bullmq';

import { emitAdminTelemetry } from '../config/socket.js';
import type { MatchingEngine } from '../matching/MatchingEngine.js';

export const HEAP_SNAPSHOT_LEVELS = 5;

export type QueueTelemetry = {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  queue?: string;
  timestamp: string;
};

export type HeapTelemetry = {
  pair: string;
  bids: Array<{ price: number; quantity: number; orderCount: number }>;
  asks: Array<{ price: number; quantity: number; orderCount: number }>;
  timestamp: string;
};

export type TransactionTelemetry = {
  sessionId: string;
  sessionID: string;
  durationMs: number;
  status: 'COMMITTED' | 'ROLLED_BACK';
  error?: string;
  timestamp: string;
};

export function emitQueueTelemetry(payload: {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  queue?: string;
  timestamp?: string;
}): void {
  const message: QueueTelemetry = {
    waiting: payload.waiting,
    active: payload.active,
    completed: payload.completed,
    failed: payload.failed,
    queue: payload.queue,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };
  emitAdminTelemetry('telemetry:queue', message);
}

export async function broadcastQueueTelemetry(queue: Queue): Promise<void> {
  const counts = await queue.getJobCounts('waiting', 'active', 'completed', 'failed');
  emitQueueTelemetry({
    queue: queue.name,
    waiting: counts.waiting ?? 0,
    active: counts.active ?? 0,
    completed: counts.completed ?? 0,
    failed: counts.failed ?? 0,
  });
}

export function emitHeapTelemetry(payload: {
  pair: string;
  bids: Array<{ price: number; quantity: number; orderCount: number }>;
  asks: Array<{ price: number; quantity: number; orderCount: number }>;
}): void {
  const message: HeapTelemetry = {
    pair: payload.pair,
    bids: payload.bids.slice(0, HEAP_SNAPSHOT_LEVELS),
    asks: payload.asks.slice(0, HEAP_SNAPSHOT_LEVELS),
    timestamp: new Date().toISOString(),
  };
  emitAdminTelemetry('telemetry:heap', message);
}

export function broadcastHeapTelemetry(engine: MatchingEngine, pair: string): void {
  emitHeapTelemetry({
    pair,
    ...engine.getHeapSnapshot(pair, HEAP_SNAPSHOT_LEVELS),
  });
}

export function emitTransactionTelemetry(payload: {
  sessionId?: string;
  sessionID?: string;
  durationMs: number;
  status: 'COMMITTED' | 'ROLLED_BACK';
  error?: string;
  timestamp?: string;
}): void {
  const sessionID = payload.sessionID ?? payload.sessionId ?? 'unknown';
  const message: TransactionTelemetry = {
    sessionId: sessionID,
    sessionID,
    durationMs: payload.durationMs,
    status: payload.status,
    error: payload.error,
    timestamp: payload.timestamp ?? new Date().toISOString(),
  };
  emitAdminTelemetry('telemetry:tx', message);
}
