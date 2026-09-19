import { createServer } from 'node:http';

import { app } from './app.js';
import { connectInfrastructure, disconnectInfrastructure } from './connections.js';
import { config } from './config.js';
import { closeSocketServer, initializeSocket } from './config/socket.js';
import { seedAdmin } from './seeds/seedAdmin.js';
import { startOrderWorker, stopOrderWorker } from './workers/orderWorker.js';

async function start(): Promise<void> {
  await connectInfrastructure();
  await seedAdmin();
  const server = createServer(app);
  initializeSocket(server);
  startOrderWorker();

  server.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}; shutting down.`);
    server.close(async () => {
      await stopOrderWorker();
      await closeSocketServer();
      await disconnectInfrastructure();
      process.exit(0);
    });
  };

  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((error: unknown) => {
  console.error('Failed to start API:', error);
  process.exit(1);
});
