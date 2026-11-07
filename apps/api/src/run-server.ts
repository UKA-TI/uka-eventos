import { createApp } from './app.js';
import { ensureSystemData } from './bootstrap.js';
import { config } from './config.js';
import { prisma } from './database.js';
import { startMailWorker } from './modules/mail/queue.js';
import { pino } from 'pino';

const logger = pino({ level: config.LOG_LEVEL });
const port = config.PORT ?? config.API_PORT;

try {
  await ensureSystemData();
} catch (error) {
  // La app arranca de todos modos para que /api/health muestre el problema.
  logger.error({ err: error }, 'Could not prepare system roles');
}

const server = createApp().listen(port, () => {
  logger.info({ port }, 'API started');
});

const stopMailWorker = startMailWorker(logger);

function shutdown() {
  stopMailWorker();
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
