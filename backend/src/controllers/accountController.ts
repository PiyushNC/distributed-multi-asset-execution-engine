import type { Request, Response } from 'express';

import { Account } from '../models/Account.js';

export async function accountHandler(request: Request, response: Response): Promise<void> {
  if (!request.user) {
    response.status(401).json({ message: 'Authentication required' });
    return;
  }

  const account = await Account.findOne({ userId: request.user.userId }).lean();
  if (!account) {
    response.status(404).json({ message: 'Trading account not found' });
    return;
  }

  response.status(200).json({
    assetBalance: account.assetBalance,
    quoteBalance: account.quoteBalance,
  });
}
