import type { NextFunction, Request, Response } from 'express';

import { verifyAccessToken } from '../services/tokenService.js';

export function requireAuth(request: Request, response: Response, next: NextFunction): void {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    response.status(401).json({ message: 'Missing or invalid Authorization header' });
    return;
  }

  const token = authHeader.substring('Bearer '.length).trim();

  try {
    const payload = verifyAccessToken(token);
    request.user = {
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
    };
    next();
  } catch {
    response.status(401).json({ message: 'Invalid or expired access token' });
  }
}
