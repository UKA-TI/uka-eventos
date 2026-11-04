import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../../errors.js';

export interface MicrosoftIdentity {
  tenantId: string;
  objectId: string;
  email: string;
  displayName: string | null;
}

export type MicrosoftTokenVerifier = (
  idToken: string,
) => Promise<MicrosoftIdentity>;

function readClaim(claim: unknown): string {
  return typeof claim === 'string' ? claim.trim() : '';
}

/**
 * Valida un id_token de Microsoft Entra ID: firma RS256, emisor del tenant,
 * audiencia de esta aplicación y vigencia. Solo acepta cuentas de la organización.
 */
export function createMicrosoftTokenVerifier(
  tenantId: string,
  clientId: string,
  keys: JWTVerifyGetKey = createRemoteJWKSet(
    new URL(
      `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
    ),
  ),
): MicrosoftTokenVerifier {
  return async (idToken) => {
    let claims: Record<string, unknown>;
    try {
      const result = await jwtVerify(idToken, keys, {
        algorithms: ['RS256'],
        issuer: `https://login.microsoftonline.com/${tenantId}/v2.0`,
        audience: clientId,
      });
      claims = result.payload;
    } catch (error) {
      throw new AppError(401, 'No se pudo validar tu sesión de Microsoft.', {
        cause: error,
      });
    }

    const tokenTenant = readClaim(claims.tid);
    const objectId = readClaim(claims.oid);
    const email = (
      readClaim(claims.preferred_username) || readClaim(claims.email)
    ).toLowerCase();

    if (
      tokenTenant.toLowerCase() !== tenantId.toLowerCase() ||
      !objectId ||
      !email
    ) {
      throw new AppError(
        401,
        'El token de Microsoft no identifica a una cuenta de la organización.',
      );
    }

    return {
      tenantId: tokenTenant,
      objectId,
      email,
      displayName: readClaim(claims.name) || null,
    };
  };
}
