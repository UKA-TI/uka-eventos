import cors from 'cors';
import express, { type ErrorRequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import type { HealthResponse } from '@uka/shared';
import { config } from './config.js';
import { pool } from './database.js';

export interface HealthDatabase {
  query(sql: string): Promise<unknown>;
}

const logger = pino({ level: config.LOG_LEVEL });

class HealthCheckError extends Error {
  constructor(cause: unknown) {
    super('MySQL health check failed', { cause });
    this.name = 'HealthCheckError';
  }
}

export function createApp(database: HealthDatabase = pool) {
  const app = express();
  const allowedOrigins = new Set(
    config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  );

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new Error('Origin is not allowed by CORS'));
      },
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 100,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
    }),
  );

  app.get('/api/health', async (_request, response, next) => {
    try {
      await database.query('SELECT 1');
      const body: HealthResponse = { status: 'ok', database: 'ok' };
      response.status(200).json(body);
    } catch (error) {
      next(new HealthCheckError(error));
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  const errorHandler: ErrorRequestHandler = (
    error,
    _request,
    response,
    _next,
  ) => {
    logger.error({ err: error }, 'Request failed');
    if (error instanceof HealthCheckError) {
      response.status(503).json({ error: 'Service unavailable' });
      return;
    }

    response.status(500).json({ error: 'Internal server error' });
  };
  app.use(errorHandler);

  return app;
}
