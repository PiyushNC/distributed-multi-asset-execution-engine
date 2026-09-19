import type { Request, Response } from 'express';

import { matchingEngine } from './orderController.js';

export function orderBookHandler(request: Request, response: Response): void {
  const rawPair = request.params.pair;
  const pair = typeof rawPair === 'string' ? rawPair.trim().toUpperCase() : '';
  if (!/^[A-Z0-9]+-[A-Z0-9]+$/.test(pair)) {
    response.status(400).json({ message: 'Invalid trading pair' });
    return;
  }

  response.status(200).json({
    pair,
    ...matchingEngine.getTopDepth(pair),
    timestamp: new Date().toISOString(),
  });
}
