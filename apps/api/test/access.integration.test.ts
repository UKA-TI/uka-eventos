import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { ensureSystemData } from '../src/bootstrap.js';
import { prisma } from '../src/database.js';
import type { MicrosoftIdentity } from '../src/modules/auth/entra.js';

/**
 * Flujo real contra MariaDB (no corre en CI). Ejecutar con:
 *   npm run test:db-integration --workspace @uka/api
 */
const run = randomBytes(4).toString('hex');
const domain = `${run}.uka.test`;
const origin = 'http://localhost:5173';
const tenantId = `tenant-${run}`;

const identity = (name: string): MicrosoftIdentity => ({
  tenantId,
  objectId: `oid-${run}-${name}`,
  email: `${name}@${domain}`,
  displayName: `${name} desde Microsoft`,
});

// El token de prueba es la propia identidad: el verificador real está probado
// por separado en auth.test.ts.
const app = createApp(undefined, {
  microsoftVerifier: (token) =>
    Promise.resolve(JSON.parse(token) as MicrosoftIdentity),
});

async function login(person: MicrosoftIdentity) {
  const agent = request.agent(app);
  const response = await agent
    .post('/api/auth/microsoft')
    .set('Origin', origin)
    .send({ idToken: JSON.stringify(person) });
  return { agent, response, csrf: response.body.csrfToken as string };
}

describe.skipIf(!process.env.RUN_DB_TESTS)('access control flow', () => {
  let adminRoleId = '';
  let receptionRoleId = '';
  const customRoles: string[] = [];

  beforeAll(async () => {
    await ensureSystemData(undefined);
    adminRoleId = (
      await prisma.role.findUniqueOrThrow({ where: { code: 'ADMIN' } })
    ).id;
    receptionRoleId = (
      await prisma.role.findUniqueOrThrow({ where: { code: 'RECEPTION' } })
    ).id;
    await prisma.user.create({
      data: {
        email: `boss@${domain}`,
        displayName: 'Boss',
        roleId: adminRoleId,
      },
    });
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { endsWith: `@${domain}` } },
      select: { id: true },
    });
    await prisma.auditLog.deleteMany({
      where: { userId: { in: users.map((user) => user.id) } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((user) => user.id) } },
    });
    await prisma.role.deleteMany({ where: { id: { in: customRoles } } });
    await prisma.$disconnect();
  });

  it('refuses a Microsoft account that was not invited', async () => {
    const { response } = await login(identity('stranger'));
    expect(response.status).toBe(403);
    expect(response.body.error).toContain('no tiene acceso');
  });

  it('activates an invitation on first login and links the identity', async () => {
    const { response } = await login(identity('boss'));
    expect(response.status).toBe(200);
    expect(response.body.user.displayName).toBe('boss desde Microsoft');
    expect(response.body.user.permissions).toContain('roles.manage');
    const stored = await prisma.user.findUniqueOrThrow({
      where: { email: `boss@${domain}` },
    });
    expect(stored.status).toBe('active');
    expect(stored.entraOid).toBe(identity('boss').objectId);
  });

  it('keeps recognizing the person if their email changes', async () => {
    const { response } = await login({
      ...identity('boss'),
      email: `renamed@${domain}`,
    });
    expect(response.status).toBe(200);
    expect(response.body.user.email).toBe(`boss@${domain}`);
  });

  it('does not let another identity take over a linked email', async () => {
    const { response } = await login({
      ...identity('boss'),
      objectId: `oid-${run}-impostor`,
    });
    expect(response.status).toBe(403);
    expect(response.body.error).toContain('otra identidad');
  });

  it('requires a CSRF token to change data', async () => {
    const { agent } = await login(identity('boss'));
    const response = await agent
      .post('/api/users')
      .set('Origin', origin)
      .send({
        email: `nobody@${domain}`,
        displayName: 'Nobody',
        roleId: receptionRoleId,
      });
    expect(response.status).toBe(403);
  });

  it('applies custom profile permissions immediately', async () => {
    const { agent, csrf } = await login(identity('boss'));
    const role = await agent
      .post('/api/roles')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        name: `Coordinación ${run}`,
        description: null,
        permissions: ['events.view', 'users.view'],
      });
    expect(role.status).toBe(201);
    customRoles.push(role.body.id);

    const invite = await agent
      .post('/api/users')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        email: `coord@${domain}`,
        displayName: 'Coord',
        roleId: role.body.id,
      });
    expect(invite.status).toBe(201);
    expect(invite.body.status).toBe('invited');

    const coord = await login(identity('coord'));
    expect(coord.response.status).toBe(200);
    expect((await coord.agent.get('/api/users')).status).toBe(200);
    expect((await coord.agent.get('/api/roles')).status).toBe(200);

    const update = await agent
      .put(`/api/roles/${role.body.id}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        name: `Coordinación ${run}`,
        description: null,
        permissions: ['events.view'],
      });
    expect(update.status).toBe(200);
    expect((await coord.agent.get('/api/users')).status).toBe(403);
  });

  it('prevents privilege escalation by limited managers', async () => {
    const { agent, csrf } = await login(identity('boss'));
    const role = await agent
      .post('/api/roles')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        name: `Gestor ${run}`,
        description: null,
        permissions: ['users.manage', 'roles.manage'],
      });
    customRoles.push(role.body.id);
    await agent
      .post('/api/users')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        email: `manager@${domain}`,
        displayName: 'Manager',
        roleId: role.body.id,
      });

    const manager = await login(identity('manager'));
    const grant = await manager.agent
      .put(`/api/roles/${role.body.id}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', manager.csrf)
      .send({
        name: `Gestor ${run}`,
        description: null,
        permissions: ['users.manage', 'roles.manage', 'events.edit'],
      });
    expect(grant.status).toBe(403);

    const makeAdmin = await manager.agent
      .post('/api/users')
      .set('Origin', origin)
      .set('X-CSRF-Token', manager.csrf)
      .send({
        email: `evil@${domain}`,
        displayName: 'Evil',
        roleId: adminRoleId,
      });
    expect(makeAdmin.status).toBe(403);

    const boss = await prisma.user.findUniqueOrThrow({
      where: { email: `boss@${domain}` },
    });
    const editAdmin = await manager.agent
      .put(`/api/users/${boss.id}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', manager.csrf)
      .send({ displayName: 'Hacked', roleId: boss.roleId, enabled: false });
    expect(editAdmin.status).toBe(403);
  });

  it('protects the administrator profile and the system roles', async () => {
    const { agent, csrf } = await login(identity('boss'));
    const edit = await agent
      .put(`/api/roles/${adminRoleId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ name: 'Otro', description: null, permissions: [] });
    expect(edit.status).toBe(409);
    const remove = await agent
      .delete(`/api/roles/${receptionRoleId}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf);
    expect(remove.status).toBe(409);
  });

  it('does not let people lock themselves out', async () => {
    const { agent, csrf, response } = await login(identity('boss'));
    const self = await agent
      .put(`/api/users/${response.body.user.id}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ displayName: 'Boss', roleId: adminRoleId, enabled: false });
    expect(self.status).toBe(409);
  });

  it('ends open sessions when a user is deactivated', async () => {
    const { agent, csrf } = await login(identity('boss'));
    const invite = await agent
      .post('/api/users')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({
        email: `temp@${domain}`,
        displayName: 'Temp',
        roleId: receptionRoleId,
      });
    const temp = await login(identity('temp'));
    expect((await temp.agent.get('/api/events')).status).toBe(200);

    const disable = await agent
      .put(`/api/users/${invite.body.id}`)
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send({ displayName: 'Temp', roleId: receptionRoleId, enabled: false });
    expect(disable.status).toBe(200);
    expect(disable.body.status).toBe('inactive');

    expect((await temp.agent.get('/api/events')).status).toBe(401);
    expect((await login(identity('temp'))).response.status).toBe(403);
  });
});
