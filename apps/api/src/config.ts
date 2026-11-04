import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({
  path: resolve(fileURLToPath(new URL('../../../.env', import.meta.url))),
});

const optionalText = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().optional(),
);

const configSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
    .default('info'),
  SESSION_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(8),
  AZURE_TENANT_ID: optionalText,
  AZURE_CLIENT_ID: optionalText,
  BOOTSTRAP_ADMIN_EMAIL: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().trim().toLowerCase().email().optional(),
  ),
  PASS_TOKEN_SECRET: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().min(32).optional(),
  ),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  MAIL_FROM: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().email().default('eventos@unkilodeayuda.org.mx'),
  ),
  MAIL_CLIENT_ID: optionalText,
  MAIL_CLIENT_SECRET: optionalText,
  MAIL_RATE_PER_MINUTE: z.coerce.number().int().min(1).max(30).default(25),
  MAIL_DAILY_LIMIT: z.coerce.number().int().min(1).max(10000).default(8000),
  DEV_LOGIN_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_NAME: z.string().default('uka_eventos'),
  DB_USER: z.string().default('uka_app'),
  DB_PASSWORD: z.string().default('uka_local_dev'),
  DATABASE_URL: z
    .string()
    .url()
    .refine((value) => value.startsWith('mysql://'), {
      message: 'DATABASE_URL must use the mysql:// protocol',
    })
    .optional(),
});

const parsedConfig = configSchema.parse(process.env);

if (parsedConfig.NODE_ENV === 'production') {
  if (!parsedConfig.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set in production');
  }
  if (!parsedConfig.PASS_TOKEN_SECRET) {
    throw new Error('PASS_TOKEN_SECRET must be set in production');
  }
  if (parsedConfig.DEV_LOGIN_ENABLED) {
    throw new Error('DEV_LOGIN_ENABLED must not be enabled in production');
  }
  if (!parsedConfig.AZURE_TENANT_ID || !parsedConfig.AZURE_CLIENT_ID) {
    throw new Error(
      'AZURE_TENANT_ID and AZURE_CLIENT_ID must be set in production',
    );
  }
}

const databaseUrl =
  parsedConfig.DATABASE_URL ??
  `mysql://${encodeURIComponent(parsedConfig.DB_USER)}:${encodeURIComponent(parsedConfig.DB_PASSWORD)}@${parsedConfig.DB_HOST}:${parsedConfig.DB_PORT}/${encodeURIComponent(parsedConfig.DB_NAME)}`;

export const config = {
  ...parsedConfig,
  SESSION_SECRET:
    parsedConfig.SESSION_SECRET ?? 'local-development-session-secret-32chars',
  PASS_TOKEN_SECRET:
    parsedConfig.PASS_TOKEN_SECRET ?? 'local-development-pass-secret-32-chars',
  DATABASE_URL: databaseUrl,
};
