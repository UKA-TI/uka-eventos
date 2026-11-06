import { describe, expect, it } from 'vitest';
import express, { type RequestHandler } from 'express';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import request from 'supertest';
import { allPermissions } from '@uka/shared';
import { createApp } from '../src/app.js';
import {
  createCsrfToken,
  effectivePermissions,
  hashSessionToken,
  matchesCsrfToken,
  requirePermission,
  type AuthenticatedRequest,
} from '../src/modules/auth/auth.js';
import { createMicrosoftTokenVerifier } from '../src/modules/auth/entra.js';

const TENANT = '11111111-1111-1111-1111-111111111111';
const CLIENT = '22222222-2222-2222-2222-222222222222';

async function tokenFactory() {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const sign = (
    claims: Record<string, unknown>,
    overrides: { issuer?: string; audience?: string; expires?: string } = {},
  ) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(
        overrides.issuer ?? `https://login.microsoftonline.com/${TENANT}/v2.0`,
      )
      .setAudience(overrides.audience ?? CLIENT)
      .setIssuedAt()
      .setExpirationTime(overrides.expires ?? '5m')
      .sign(privateKey);
  return {
    sign,
    verify: createMicrosoftTokenVerifier(TENANT, CLIENT, keys),
  };
}

const goodClaims = {
  tid: TENANT,
  oid: 'object-1',
  preferred_username: 'Persona@UnKiloDeAyuda.org.mx',
  name: 'Persona Ejemplo',
};

describe('Microsoft token validation', () => {
  it('accepts a valid token and normalizes the identity', async () => {
    const { sign, verify } = await tokenFactory();
    await expect(verify(await sign(goodClaims))).resolves.toEqual({
      tenantId: TENANT,
      objectId: 'object-1',
      email: 'persona@unkilodeayuda.org.mx',
      displayName: 'Persona Ejemplo',
    });
  });

  it.each([
    ['another issuer', { issuer: 'https://login.microsoftonline.com/x/v2.0' }],
    ['another application', { audience: 'other-client' }],
    ['an expired token', { expires: '-1m' }],
  ])('rejects %s', async (_label, overrides) => {
    const { sign, verify } = await tokenFactory();
    await expect(verify(await sign(goodClaims, overrides))).rejects.toThrow(
      'No se pudo validar',
    );
  });

  it('rejects a token signed with an unknown key', async () => {
    const { verify } = await tokenFactory();
    const other = await tokenFactory();
    await expect(verify(await other.sign(goodClaims))).rejects.toThrow(
      'No se pudo validar',
    );
  });

  it.each([
    ['another tenant', { ...goodClaims, tid: 'other-tenant' }],
    ['no object id', { ...goodClaims, oid: undefined }],
    ['no email', { ...goodClaims, preferred_username: undefined }],
  ])('rejects a token with %s', async (_label, claims) => {
    const { sign, verify } = await tokenFactory();
    await expect(verify(await sign(claims))).rejects.toThrow(
      'cuenta de la organización',
    );
  });
});

describe('session security helpers', () => {
  it('hashes session tokens instead of storing their raw value', () => {
    const token = 'random-session-token';
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).toHaveLength(64);
  });

  it('creates a session-bound CSRF token and compares it safely', () => {
    const token = createCsrfToken('session-token');
    expect(matchesCsrfToken(token, token)).toBe(true);
    expect(matchesCsrfToken(token, createCsrfToken('another-session'))).toBe(
      false,
    );
    expect(matchesCsrfToken(token, 'wrong')).toBe(false);
  });
});

describe('permissions', () => {
  it('gives the administrator every permission, including future ones', () => {
    expect(effectivePermissions({ code: 'ADMIN', permissions: [] })).toEqual(
      allPermissions,
    );
  });

  it('ignores stored permissions missing from the catalog', () => {
    expect(
      effectivePermissions({
        code: 'CUSTOM_1',
        permissions: [{ permission: 'events.view' }, { permission: 'old.one' }],
      }),
    ).toEqual(['events.view']);
  });

  it('blocks users without the required permission', async () => {
    const app = express();
    const attachUser: RequestHandler = (req, _res, next) => {
      (req as AuthenticatedRequest).authUser = {
        id: 'user-1',
        email: 'recepcion@uka.test',
        displayName: 'Recepción',
        roleName: 'Recepción',
        permissions: ['events.view'],
        isAdmin: false,
      };
      next();
    };
    app.get(
      '/view',
      attachUser,
      requirePermission('events.view', 'events.edit'),
      (_req, res) => res.sendStatus(204),
    );
    app.get(
      '/manage',
      attachUser,
      requirePermission('users.manage'),
      (_req, res) => res.sendStatus(204),
    );

    expect((await request(app).get('/view')).status).toBe(204);
    expect((await request(app).get('/manage')).status).toBe(403);
  });
});

describe('authentication routes', () => {
  it('returns an empty session for a logged-out browser', async () => {
    const response = await request(createApp()).get('/api/auth/session');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ user: null, csrfToken: null });
  });

  it('rejects protected modules without an authenticated session', async () => {
    const app = createApp();
    for (const path of ['/api/events', '/api/users', '/api/roles']) {
      expect((await request(app).get(path)).status).toBe(401);
    }
  });

  it('no longer exposes a password login', async () => {
    const response = await request(createApp())
      .post('/api/auth/login')
      .send({ email: 'a@uka.test', password: 'whatever-password' });
    expect(response.status).toBe(404);
  });

  it('rejects a malformed Microsoft login before consulting the database', async () => {
    const app = createApp(undefined, {
      microsoftVerifier: () => Promise.reject(new Error('must not be called')),
    });
    const response = await request(app).post('/api/auth/microsoft').send({});
    expect(response.status).toBe(400);
  });

  it('rejects Microsoft logins from origins that are not allowed', async () => {
    const response = await request(createApp())
      .post('/api/auth/microsoft')
      .set('Origin', 'https://evil.example')
      .send({ idToken: 'x' });
    expect(response.status).toBe(403);
  });
});
