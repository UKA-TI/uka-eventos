import { createApp } from './app.js';
import { ensureSystemData } from './bootstrap.js';
import { config } from './config.js';
import { prisma, probeDatabase } from './database.js';
import { errorReason } from './error-reason.js';
import { startMailWorker } from './modules/mail/queue.js';
import { pino } from 'pino';

const logger = pino({ level: config.LOG_LEVEL });
const port = config.PORT ?? config.API_PORT;

// Primero abre el puerto: el hospedaje revisa que la app responda pronto, y preparar
// los datos del sistema puede tardar si la base aún no contesta. Escucha en todas
// las interfaces (0.0.0.0) para que el proxy del hospedaje la encuentre.
const server = createApp().listen(port, '0.0.0.0', () => {
  logger.info(
    { port, portFromEnvironment: process.env.PORT !== undefined },
    `API started on port ${port}`,
  );
});

try {
  await ensureSystemData();
} catch (error) {
  // La app sigue en marcha para que /api/health muestre el problema.
  logger.error(
    { err: error },
    `Could not prepare system roles: ${errorReason(error)}`,
  );
  logger.error(`Database check: ${await probeDatabase()}`);
}

const stopMailWorker = startMailWorker(logger);

function shutdown() {
  stopMailWorker();
  server.close(() => {
    void prisma.$disconnect().then(() => process.exit(0));
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
