import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import mariadb from 'mariadb';
import { PrismaClient } from './generated/prisma/client.js';
import { config } from './config.js';
import { errorReason } from './error-reason.js';

const databaseUrl = new URL(config.DATABASE_URL);
const connection = {
  host: databaseUrl.hostname,
  port: Number(databaseUrl.port || 3306),
  user: decodeURIComponent(databaseUrl.username),
  password: decodeURIComponent(databaseUrl.password),
  database: decodeURIComponent(databaseUrl.pathname.slice(1)),
  charset: 'utf8mb4',
  timezone: 'Z',
  // MySQL 8 (la base alojada de GoDaddy) autentica con caching_sha2_password y,
  // sin TLS, el conector necesita pedir la llave pública al servidor.
  allowPublicKeyRetrieval: true,
} as const;

const adapter = new PrismaMariaDb({ ...connection, connectionLimit: 10 });

export const prisma = new PrismaClient({ adapter });

export const healthDatabase = {
  query: () => prisma.$queryRaw`SELECT 1`,
};

// El pool solo informa "no pudo obtener conexión". Una conexión directa revela la
// causa real (acceso denegado, servidor inalcanzable, base inexistente…). Nunca
// incluye la contraseña.
export async function probeDatabase(): Promise<string> {
  const where = `${connection.host}:${connection.port}/${connection.database} (usuario ${connection.user})`;
  try {
    const conn = await mariadb.createConnection({
      ...connection,
      connectTimeout: 8000,
    });
    await conn.end();
    return `la conexión directa a ${where} sí funciona`;
  } catch (error) {
    return `${where}: ${errorReason(error)}`;
  }
}
