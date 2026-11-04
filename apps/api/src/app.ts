import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { pino } from 'pino';
import { pinoHttp } from 'pino-http';
import type { HealthResponse } from '@uka/shared';
import { config } from './config.js';
import { healthDatabase } from './database.js';
import { AppError, createErrorHandler } from './errors.js';

export interface HealthDatabase {
  query(): Promise<unknown>;
}

const logger = pino({ level: config.LOG_LEVEL });

export function createApp(database: HealthDatabase = healthDatabase) {
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
      await database.query();
      const body: HealthResponse = { status: 'ok', database: 'ok' };
      response.status(200).json(body);
    } catch (error) {
      next(new AppError(503, 'Service unavailable', { cause: error }));
    }
  });

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use(createErrorHandler(logger));

  return app;
}
