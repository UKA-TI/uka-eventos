import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { config } from '../../config.js';

/**
 * Los tokens se derivan del id con un secreto del servidor. Así se puede volver
 * a generar la misma liga o el mismo QR sin guardar el token: la base de datos
 * solo conserva su hash.
 */
function deriveToken(
  kind: 'pass' | 'group' | 'unsubscribe',
  id: string,
): string {
  return createHmac('sha256', config.PASS_TOKEN_SECRET)
    .update(`${kind}:${id}`)
    .digest('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const passToken = (passId: string) => deriveToken('pass', passId);
export const groupToken = (orderId: string) => deriveToken('group', orderId);

/** La baja lleva el id para no tener que guardar un token por contacto. */
export const unsubscribeToken = (contactId: string) =>
  `${contactId}.${deriveToken('unsubscribe', contactId)}`;

export function contactIdFromUnsubscribeToken(token: string): string | null {
  const [contactId, signature, extra] = token.split('.');
  if (!contactId || !signature || extra !== undefined) {
    return null;
  }
  const expected = Buffer.from(deriveToken('unsubscribe', contactId));
  const received = Buffer.from(signature);
  return expected.length === received.length &&
    timingSafeEqual(expected, received)
    ? contactId
    : null;
}

export function newRecordId(): string {
  return randomBytes(12).toString('hex');
}

export const passUrl = (passId: string) =>
  `${config.PUBLIC_BASE_URL}/pase/${passToken(passId)}`;
export const groupUrl = (orderId: string) =>
  `${config.PUBLIC_BASE_URL}/mesa/${groupToken(orderId)}`;
export const unsubscribeUrl = (contactId: string) =>
  `${config.PUBLIC_BASE_URL}/baja/${unsubscribeToken(contactId)}`;
export const registrationUrl = (slug: string) =>
  `${config.PUBLIC_BASE_URL}/r/${slug}`;
