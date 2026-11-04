import { createHash, createHmac, randomBytes } from 'node:crypto';
import { config } from '../../config.js';

/**
 * Los tokens se derivan del id con un secreto del servidor. Así se puede volver
 * a generar la misma liga o el mismo QR sin guardar el token: la base de datos
 * solo conserva su hash.
 */
function deriveToken(kind: 'pass' | 'group', id: string): string {
  return createHmac('sha256', config.PASS_TOKEN_SECRET)
    .update(`${kind}:${id}`)
    .digest('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const passToken = (passId: string) => deriveToken('pass', passId);
export const groupToken = (orderId: string) => deriveToken('group', orderId);

export function newRecordId(): string {
  return randomBytes(12).toString('hex');
}

export const passUrl = (passId: string) =>
  `${config.PUBLIC_BASE_URL}/pase/${passToken(passId)}`;
export const groupUrl = (orderId: string) =>
  `${config.PUBLIC_BASE_URL}/mesa/${groupToken(orderId)}`;
export const registrationUrl = (slug: string) =>
  `${config.PUBLIC_BASE_URL}/r/${slug}`;
