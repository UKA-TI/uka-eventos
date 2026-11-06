import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import rateLimit from 'express-rate-limit';
import {
  ADMIN_ROLE_CODE,
  allPermissions,
  devLoginSchema,
  isPermissionCode,
  microsoftLoginSchema,
  type AuthUser,
  type PermissionCode,
} from '@uka/shared';
import { asyncHandler } from '../../async-handler.js';
import { recordAudit } from '../../audit.js';
import { config } from '../../config.js';
import { prisma } from '../../database.js';
import { AppError } from '../../errors.js';
import {
  createMicrosoftTokenVerifier,
  type MicrosoftIdentity,
  type MicrosoftTokenVerifier,
} from './entra.js';

const SESSION_COOKIE = 'uka_session';
const cookieOptions = {
  httpOnly: true,
  secure: config.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
};

const userInclude = {
  role: { include: { permissions: true } },
} as const;

export interface AuthenticatedRequest extends Request {
  authUser?: AuthUser & { isAdmin: boolean };
  sessionToken?: string;
}

function authRequest(request: Request): AuthenticatedRequest {
  return request as AuthenticatedRequest;
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createCsrfToken(token: string): string {
  return createHmac('sha256', config.SESSION_SECRET)
    .update(token)
    .digest('base64url');
}

export function matchesCsrfToken(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

/** El perfil Administrador siempre tiene todo, incluidos los permisos futuros. */
export function effectivePermissions(role: {
  code: string;
  permissions: { permission: string }[];
}): PermissionCode[] {
  if (role.code === ADMIN_ROLE_CODE) {
    return allPermissions;
  }
  return role.permissions
    .map(({ permission }) => permission)
    .filter(isPermissionCode);
}

function readCookie(request: Request, name: string): string | undefined {
  const cookies = request.headers.cookie?.split(';') ?? [];
  const prefix = `${name}=`;
  const value = cookies
    .map((cookie) => cookie.trim())
    .find((part) => part.startsWith(prefix));
  return value?.slice(prefix.length);
}

function userView(user: {
  id: string;
  email: string;
  displayName: string;
  role: {
    code: string;
    name: string;
    permissions: { permission: string }[];
  };
}): AuthUser & { isAdmin: boolean } {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    roleName: user.role.name,
    permissions: effectivePermissions(user.role),
    isAdmin: user.role.code === ADMIN_ROLE_CODE,
  };
}

function sessionBody(user: AuthUser & { isAdmin: boolean }, token: string) {
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roleName: user.roleName,
      permissions: user.permissions,
    },
    csrfToken: createCsrfToken(token),
  };
}

async function findValidSession(token: string) {
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: { include: userInclude } },
  });
  if (!session) {
    return null;
  }
  if (session.expiresAt <= new Date() || session.user.status !== 'active') {
    await prisma.authSession.deleteMany({ where: { id: session.id } });
    return null;
  }
  return session;
}

async function startSession(response: Response, userId: string) {
  const token = randomBytes(32).toString('base64url');
  const maxAge = config.SESSION_TTL_HOURS * 60 * 60 * 1000;
  await prisma.authSession.create({
    data: {
      tokenHash: hashSessionToken(token),
      userId,
      expiresAt: new Date(Date.now() + maxAge),
    },
  });
  response.cookie(SESSION_COOKIE, token, { ...cookieOptions, maxAge });
  return token;
}

export const requireAuth: RequestHandler = asyncHandler(
  async (request, response, next) => {
    const token = readCookie(request, SESSION_COOKIE);
    const session = token ? await findValidSession(token) : null;
    if (!token || !session) {
      response.clearCookie(SESSION_COOKIE, cookieOptions);
      throw new AppError(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');
    }
    authRequest(request).authUser = userView(session.user);
    authRequest(request).sessionToken = token;
    next();
  },
);

/** Permite el paso si la persona tiene al menos uno de los permisos indicados. */
export function requirePermission(
  ...permissions: PermissionCode[]
): RequestHandler {
  return (request, _response, next) => {
    const user = authRequest(request).authUser;
    if (!user) {
      next(new AppError(401, 'Tu sesión terminó. Vuelve a iniciar sesión.'));
      return;
    }
    if (!permissions.some((code) => user.permissions.includes(code))) {
      next(new AppError(403, 'No tienes permiso para realizar esta acción.'));
      return;
    }
    next();
  };
}

export function currentUser(request: Request) {
  const user = authRequest(request).authUser;
  if (!user) {
    throw new AppError(401, 'Tu sesión terminó. Vuelve a iniciar sesión.');
  }
  return user;
}

function isAllowedOrigin(request: Request): boolean {
  const origin = request.get('origin');
  if (!origin) {
    return true;
  }
  return new Set(config.CORS_ORIGIN.split(',').map((item) => item.trim())).has(
    origin,
  );
}

const requireAllowedOrigin: RequestHandler = (request, _response, next) => {
  if (!isAllowedOrigin(request)) {
    next(new AppError(403, 'Origen no permitido.'));
    return;
  }
  next();
};

export const requireCsrf: RequestHandler = (request, _response, next) => {
  const origin = request.get('origin');
  const providedToken = request.get('x-csrf-token');
  const sessionToken = authRequest(request).sessionToken;
  if (
    !origin ||
    !isAllowedOrigin(request) ||
    !providedToken ||
    !sessionToken ||
    !matchesCsrfToken(createCsrfToken(sessionToken), providedToken)
  ) {
    next(
      new AppError(403, 'Validación de seguridad fallida. Recarga la página.'),
    );
    return;
  }
  next();
};

const NOT_INVITED_MESSAGE =
  'Tu cuenta no tiene acceso a EVENTOS UKA. Pide a un administrador que te invite.';

/**
 * Resuelve quién entra. La identidad estable es tenant + object id; el correo
 * solo se usa una vez, para ligar la invitación con esa identidad.
 */
export async function resolveMicrosoftUser(identity: MicrosoftIdentity) {
  const linked = await prisma.user.findUnique({
    where: {
      entraTid_entraOid: {
        entraTid: identity.tenantId,
        entraOid: identity.objectId,
      },
    },
    include: userInclude,
  });
  const invited =
    linked ??
    (await prisma.user.findUnique({
      where: { email: identity.email },
      include: userInclude,
    }));

  if (!invited) {
    throw new AppError(403, NOT_INVITED_MESSAGE);
  }
  if (invited.status === 'inactive') {
    throw new AppError(
      403,
      'Tu acceso a EVENTOS UKA está desactivado. Contacta a un administrador.',
    );
  }
  if (!linked && invited.entraOid) {
    throw new AppError(
      403,
      'Este correo ya está ligado a otra identidad de Microsoft. Contacta a un administrador.',
    );
  }

  return prisma.user.update({
    where: { id: invited.id },
    data: {
      entraTid: identity.tenantId,
      entraOid: identity.objectId,
      status: 'active',
      lastLoginAt: new Date(),
      ...(identity.displayName ? { displayName: identity.displayName } : {}),
    },
    include: userInclude,
  });
}

function defaultVerifier(): MicrosoftTokenVerifier | null {
  return config.AZURE_TENANT_ID && config.AZURE_CLIENT_ID
    ? createMicrosoftTokenVerifier(
        config.AZURE_TENANT_ID,
        config.AZURE_CLIENT_ID,
      )
    : null;
}

export function createAuthRouter(
  verifier: MicrosoftTokenVerifier | null = defaultVerifier(),
) {
  const router = Router();
  const loginLimit = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });

  router.get('/config', (_request, response) => {
    response.json({
      microsoft:
        config.AZURE_TENANT_ID && config.AZURE_CLIENT_ID
          ? {
              clientId: config.AZURE_CLIENT_ID,
              tenantId: config.AZURE_TENANT_ID,
            }
          : null,
      devLoginEnabled: config.DEV_LOGIN_ENABLED,
    });
  });

  router.post(
    '/microsoft',
    requireAllowedOrigin,
    loginLimit,
    asyncHandler(async (request, response) => {
      if (!verifier) {
        throw new AppError(
          503,
          'El inicio de sesión con Microsoft aún no está configurado.',
        );
      }
      const { idToken } = microsoftLoginSchema.parse(request.body);
      const user = await resolveMicrosoftUser(await verifier(idToken));
      const token = await startSession(response, user.id);
      await recordAudit({
        userId: user.id,
        action: 'auth.login',
        entityType: 'user',
        entityId: user.id,
      });
      response.json(sessionBody(userView(user), token));
    }),
  );

  // Solo para desarrollo local: config.ts impide activarlo en producción.
  if (config.DEV_LOGIN_ENABLED) {
    router.post(
      '/dev-login',
      requireAllowedOrigin,
      asyncHandler(async (request, response) => {
        const { email } = devLoginSchema.parse(request.body);
        const found = await prisma.user.findUnique({ where: { email } });
        if (!found || found.status === 'inactive') {
          throw new AppError(403, NOT_INVITED_MESSAGE);
        }
        const user = await prisma.user.update({
          where: { id: found.id },
          data: { status: 'active', lastLoginAt: new Date() },
          include: userInclude,
        });
        const token = await startSession(response, user.id);
        response.json(sessionBody(userView(user), token));
      }),
    );
  }

  router.get(
    '/session',
    asyncHandler(async (request, response) => {
      const token = readCookie(request, SESSION_COOKIE);
      const session = token ? await findValidSession(token) : null;
      if (!token || !session) {
        if (token) {
          response.clearCookie(SESSION_COOKIE, cookieOptions);
        }
        response.json({ user: null, csrfToken: null });
        return;
      }
      response.json(sessionBody(userView(session.user), token));
    }),
  );

  router.post(
    '/logout',
    requireAuth,
    requireCsrf,
    asyncHandler(async (request, response) => {
      const token = authRequest(request).sessionToken;
      if (token) {
        await prisma.authSession.deleteMany({
          where: { tokenHash: hashSessionToken(token) },
        });
      }
      response.clearCookie(SESSION_COOKIE, cookieOptions);
      response.status(204).end();
    }),
  );

  return router;
}
