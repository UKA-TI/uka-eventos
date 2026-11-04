import { createApp } from './app.js';
import { config } from './config.js';
import { pool } from './database.js';
import { pino } from 'pino';

const logger = pino({ level: config.LOG_LEVEL });
const port = config.PORT ?? config.API_PORT;
const server = createApp().listen(port, () => {
  logger.info({ port }, 'API started');
});

function shutdown() {
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
