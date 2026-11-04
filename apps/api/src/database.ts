import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from './generated/prisma/client.js';
import { config } from './config.js';

const databaseUrl = new URL(config.DATABASE_URL);
const adapter = new PrismaMariaDb({
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: decodeURIComponent(databaseUrl.pathname.slice(1)),
  connectionLimit: 10,
  charset: 'utf8mb4',
  timezone: 'Z',
});

export const prisma = new PrismaClient({ adapter });

export const healthDatabase = {
  query: () => prisma.$queryRaw`SELECT 1`,
};
