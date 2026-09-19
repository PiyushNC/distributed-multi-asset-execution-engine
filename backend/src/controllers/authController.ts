import type { Request, Response } from 'express';

import { loginUser, refreshUserSession, registerUser } from '../services/authService.js';

export async function registerHandler(request: Request, response: Response): Promise<void> {
  try {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      response.status(400).json({ message: 'Email and password are required' });
      return;
    }

    const result = await registerUser(email, password);

    response.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: '/',
    });

    response.status(201).json({
      user: result.user,
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: '15m',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Registration failed';
    response.status(400).json({ message });
  }
}

export async function loginHandler(request: Request, response: Response): Promise<void> {
  try {
    const { email, password } = request.body as { email?: string; password?: string };

    if (!email || !password) {
      response.status(400).json({ message: 'Email and password are required' });
      return;
    }

    const result = await loginUser(email, password);

    response.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: '/',
    });

    response.status(200).json({
      user: result.user,
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: '15m',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    response.status(401).json({ message });
  }
}

export async function refreshHandler(request: Request, response: Response): Promise<void> {
  try {
    const refreshToken = request.cookies?.refreshToken as string | undefined;

    if (!refreshToken) {
      response.status(401).json({ message: 'Missing refresh token' });
      return;
    }

    const result = await refreshUserSession(refreshToken);

    response.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
      path: '/',
    });

    response.status(200).json({
      accessToken: result.accessToken,
      tokenType: 'Bearer',
      expiresIn: '15m',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Refresh failed';
    response.status(401).json({ message });
  }
}
