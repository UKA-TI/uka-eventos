import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({
  path: resolve(fileURLToPath(new URL('../../../.env', import.meta.url))),
});

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
const databaseUrl =
  parsedConfig.DATABASE_URL ??
  `mysql://${encodeURIComponent(parsedConfig.DB_USER)}:${encodeURIComponent(parsedConfig.DB_PASSWORD)}@${parsedConfig.DB_HOST}:${parsedConfig.DB_PORT}/${encodeURIComponent(parsedConfig.DB_NAME)}`;

export const config = { ...parsedConfig, DATABASE_URL: databaseUrl };
