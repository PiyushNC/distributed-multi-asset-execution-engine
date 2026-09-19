import type { Request, Response } from 'express';

export function meHandler(request: Request, response: Response): void {
  response.status(200).json({
    user: request.user,
    message: 'Authenticated user profile',
  });
}
