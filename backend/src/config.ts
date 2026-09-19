import 'dotenv/config';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  frontendUrl: process.env.FRONTEND_URL ?? 'http://localhost:3000',
  frontendUrls: [
    process.env.FRONTEND_URL ?? 'http://localhost:5173',
    ...(process.env.NODE_ENV === 'development'
      ? ['http://localhost:5173', 'http://localhost:5174']
      : []),
  ],
  mongoUri: requiredEnv('MONGODB_URI'),
  jwtAccessSecret: requiredEnv('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: requiredEnv('JWT_REFRESH_SECRET'),
  adminEmails: [...new Set([
    'admin@arc.io',
    ...(process.env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean),
  ])],
  accessTokenTtl: '15m',
  refreshTokenTtl: '7d',
};
