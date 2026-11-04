import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { defineConfig } from 'prisma/config';

dotenv.config({
  path: resolve(fileURLToPath(new URL('../../.env', import.meta.url))),
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url:
      process.env.DATABASE_URL ??
      'mysql://uka_app:uka_local_dev@127.0.0.1:3306/uka_eventos',
  },
});
