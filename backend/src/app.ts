import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';

import { infrastructureStatus } from './connections.js';
import { config } from './config.js';
import authRoutes from './routes/authRoutes.js';
import accountRoutes from './routes/accountRoutes.js';
import marketRoutes from './routes/marketRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import userRoutes from './routes/userRoutes.js';

export const app = express();

app.use(express.json());
app.use(cookieParser());
app.use(cors({ origin: config.frontendUrls, credentials: true }));

app.use('/auth', authRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api', userRoutes);
app.use('/api/orders', orderRoutes);

app.get('/health', (_request, response) => {
  const infrastructure = infrastructureStatus();
  const healthy = infrastructure.mongo === 'connected' && infrastructure.redis === 'connected';

  response.status(healthy ? 200 : 503).json({
    status: healthy ? 'ok' : 'degraded',
    service: 'execution-engine-api',
    infrastructure,
    timestamp: new Date().toISOString(),
  });
});
