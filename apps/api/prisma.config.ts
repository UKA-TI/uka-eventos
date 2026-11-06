import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({
  path: resolve(fileURLToPath(new URL('../../.env', import.meta.url))),
});

// Same rule as src/config.ts: DATABASE_URL wins; otherwise build it from the
// DB_* variables that GoDaddy's hosted database injects.
const env = process.env;
const databaseUrl =
  env.DATABASE_URL ||
  `mysql://${encodeURIComponent(env.DB_USER ?? 'uka_app')}:${encodeURIComponent(env.DB_PASSWORD ?? 'uka_local_dev')}@${env.DB_HOST ?? '127.0.0.1'}:${env.DB_PORT ?? '3306'}/${encodeURIComponent(env.DB_NAME ?? 'uka_eventos')}`;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: databaseUrl,
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
