import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './database.js';
import { pino } from 'pino';

const logger = pino({ level: config.LOG_LEVEL });
const server = createApp().listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT }, 'API started');
});

function shutdown() {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
