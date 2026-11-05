import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
import { createAuthRouter, requireAuth } from './modules/auth/auth.js';
import type { MicrosoftTokenVerifier } from './modules/auth/entra.js';
import { checkinRouter } from './modules/checkin/checkin.js';
import {
  auditRouter,
  consentsRouter,
} from './modules/compliance/compliance.js';
import {
  campaignsRouter,
  templatesRouter,
} from './modules/communications/communications.js';
import {
  companiesRouter,
  contactsRouter,
  segmentsRouter,
} from './modules/contacts/contacts.js';
import { donationsRouter } from './modules/donations/donations.js';
import { eventsRouter } from './modules/events/events.js';
import { financeRouter } from './modules/finance/finance.js';
import { publicRouter } from './modules/public/public.js';
import { reportsRouter } from './modules/reports/reports.js';
import { rolesRouter } from './modules/roles/roles.js';
import { seriesRouter } from './modules/series/series.js';
import { usersRouter } from './modules/users/users.js';

export interface HealthDatabase {
  query(): Promise<unknown>;
}

export interface AppOptions {
  microsoftVerifier?: MicrosoftTokenVerifier;
}

const logger = pino({ level: config.LOG_LEVEL });
const webRoot = fileURLToPath(new URL('../../web/dist', import.meta.url));

export function createApp(
  database: HealthDatabase = healthDatabase,
  options: AppOptions = {},
) {
  const app = express();
  const allowedOrigins = new Set(
    config.CORS_ORIGIN.split(',').map((origin) => origin.trim()),
  );

  app.disable('x-powered-by');
  // GoDaddy publica la app detrás de un proxy; sin esto el límite de peticiones
  // vería a todos los usuarios como una sola IP.
  if (config.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          connectSrc: ["'self'", 'https://login.microsoftonline.com'],
          imgSrc: ["'self'", 'data:'],
        },
      },
    }),
  );
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
          callback(null, true);
          return;
        }

        callback(new AppError(403, 'Origen no permitido.'));
      },
      credentials: true,
      allowedHeaders: ['Content-Type', 'X-CSRF-Token'],
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(pinoHttp({ logger }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 1000,
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

  app.use('/api/auth', createAuthRouter(options.microsoftVerifier));
  app.use('/api/events', eventsRouter);
  app.use('/api/checkin', requireAuth, checkinRouter);
  app.use('/api/series', seriesRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/roles', rolesRouter);
  app.use('/api/contacts', contactsRouter);
  app.use('/api/companies', companiesRouter);
  app.use('/api/segments', segmentsRouter);
  app.use('/api/email-templates', templatesRouter);
  app.use('/api/campaigns', campaignsRouter);
  app.use('/api/donations', donationsRouter);
  app.use('/api/reports', reportsRouter);
  app.use('/api/finance', financeRouter);
  app.use('/api/audit', auditRouter);
  app.use('/api/consents', consentsRouter);
  app.use('/api/public', publicRouter);

  app.use('/api', (_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  // En producción la misma app de Node entrega la interfaz: un solo dominio,
  // sin CORS entre sitios y con la cookie de sesión en el mismo origen.
  if (existsSync(webRoot)) {
    app.use(express.static(webRoot));
    app.get('*', (_request, response) => {
      response.sendFile('index.html', { root: webRoot });
    });
  }

  app.use((_request, response) => {
    response.status(404).json({ error: 'Not found' });
  });

  app.use(createErrorHandler(logger));

  return app;
}
