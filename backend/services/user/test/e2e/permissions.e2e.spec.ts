import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser, DataScope } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
  seedRolePermissionsInRedis,
} from './setup';

// Override table name for test isolation
jest.mock('../../src/users/constants/dynamo.constants', () => ({
  USERS_TABLE: 'BitCRM_Users_Test',
  GSI1_NAME: 'RoleIndex',
  GSI2_NAME: 'DepartmentIndex',
}));

jest.mock('../../src/roles/constants/dynamo.constants', () => ({
  ROLES_TABLE: 'BitCRM_Users_Test',
  ROLES_GSI1_NAME: 'RoleIndex',
}));

describe('Permissions enforcement (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

  const superAdminUser: JwtUser = {
    id: 'super-admin-1',
    cognitoSub: 'cognito-super',
    email: 'super@test.com',
    roleId: 'role-super-admin',
    department: 'Engineering',
  };

  beforeAll(async () => {
    app = await setupApp();
    httpServer = app.getHttpServer();
  });

  afterAll(async () => {
    await teardownApp();
  });

  beforeEach(async () => {
    await cleanupData();
  });

  // Helper to create a role via API and seed its permissions into Redis
  async function createRole(body: Record<string, unknown>) {
    const res = await request(httpServer)
      .post('/api/users/roles')
      .set('x-test-user', createTestUserHeader(superAdminUser))
      .send(body);
    expect(res.status).toBe(201);
    // Seed the new role's permissions into Redis so PermissionGuard can resolve them
    await seedRolePermissionsInRedis(res.body.data.id);
    return res.body.data;
  }

  // Helper to create a user via API
  async function createUser(body: Record<string, unknown>) {
    const res = await request(httpServer)
      .post('/api/users')
      .set('x-test-user', createTestUserHeader(superAdminUser))
      .send(body);
    expect(res.status).toBe(201);
    return res.body.data;
  }

  // Helper to build a JwtUser from a created user + role
  function makeJwtUser(user: Record<string, string>, roleId: string): JwtUser {
    return {
      id: user.id,
      cognitoSub: user.cognitoSub,
      email: user.email,
      roleId: roleId,
      department: user.department || 'HVAC',
    };
  }

  describe('basic permission enforcement', () => {
    it('user with users.view=true can GET /api/users/:id', async () => {
      // Create a role that allows viewing users
      const role = await createRole({
        name: 'Viewer Role',
        permissions: {
          users: { view: true, create: false, edit: false, delete: false },
        },
        dataScope: { users: DataScope.ALL },
        dealStageTransitions: [],
        priority: 20,
      });

      // Create a user with this role
      const targetUser = await createUser({
        email: 'target@test.com',
        firstName: 'Target',
        lastName: 'User',
        roleId: role.id,
        department: 'HVAC',
      });

      const viewerUser = await createUser({
        email: 'viewer@test.com',
        firstName: 'Viewer',
        lastName: 'User',
        roleId: role.id,
        department: 'HVAC',
      });

      const caller = makeJwtUser(viewerUser, role.id);

      const res = await request(httpServer)
        .get(`/api/users/${targetUser.id}`)
        .set('x-test-user', createTestUserHeader(caller));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(targetUser.id);
    });

    it('user without users.view gets 403 on GET /api/users/:id', async () => {
      // Create a role that does NOT allow viewing users
      const role = await createRole({
        name: 'No View Role',
        permissions: {
          users: { view: false, create: false, edit: false, delete: false },
          deals: { view: true, create: false, edit: false, delete: false },
        },
        dataScope: { users: DataScope.ASSIGNED_ONLY },
        dealStageTransitions: [],
        priority: 10,
      });

      const user = await createUser({
        email: 'noview@test.com',
        firstName: 'No',
        lastName: 'View',
        roleId: role.id,
        department: 'HVAC',
      });

      const caller = makeJwtUser(user, role.id);

      const res = await request(httpServer)
        .get(`/api/users/${user.id}`)
        .set('x-test-user', createTestUserHeader(caller));

      expect(res.status).toBe(403);
    });

    it('user without users.create gets 403 on POST /api/users', async () => {
      const role = await createRole({
        name: 'View Only Role',
        permissions: {
          users: { view: true, create: false, edit: false, delete: false },
        },
        dataScope: { users: DataScope.DEPARTMENT },
        dealStageTransitions: [],
        priority: 15,
      });

      const user = await createUser({
        email: 'viewonly@test.com',
        firstName: 'View',
        lastName: 'Only',
        roleId: role.id,
        department: 'HVAC',
      });

      const caller = makeJwtUser(user, role.id);

      const res = await request(httpServer)
        .post('/api/users')
        .set('x-test-user', createTestUserHeader(caller))
        .send({
          email: 'blocked@test.com',
          firstName: 'Blocked',
          lastName: 'User',
          roleId: 'role-technician',
          department: 'HVAC',
        });

      expect(res.status).toBe(403);
    });
  });

  describe('role update propagation', () => {
    it('role permission update takes effect on next request', async () => {
      // Create a role without users.create
      const role = await createRole({
        name: 'Evolving Role',
        permissions: {
          users: { view: true, create: false, edit: false, delete: false },
        },
        dataScope: { users: DataScope.ALL },
        dealStageTransitions: [],
        priority: 25,
      });

      const user = await createUser({
        email: 'evolving@test.com',
        firstName: 'Evolving',
        lastName: 'User',
        roleId: role.id,
        department: 'HVAC',
      });

      const caller = makeJwtUser(user, role.id);

      // Verify create is blocked
      const blockedRes = await request(httpServer)
        .post('/api/users')
        .set('x-test-user', createTestUserHeader(caller))
        .send({
          email: 'attempt1@test.com',
          firstName: 'Attempt',
          lastName: 'One',
          roleId: 'role-technician',
          department: 'HVAC',
        });

      expect(blockedRes.status).toBe(403);

      // Update the role to grant users.create
      await request(httpServer)
        .put(`/api/users/roles/${role.id}`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: {
            users: { view: true, create: true, edit: false, delete: false },
          },
        });

      // Re-seed role permissions in Redis after update
      await seedRolePermissionsInRedis(role.id);

      // Now the same user should be able to create
      const allowedRes = await request(httpServer)
        .post('/api/users')
        .set('x-test-user', createTestUserHeader(caller))
        .send({
          email: 'attempt2@test.com',
          firstName: 'Attempt',
          lastName: 'Two',
          roleId: 'role-technician',
          department: 'HVAC',
        });

      expect(allowedRes.status).toBe(201);
    });

    it('revoking permission blocks previously allowed actions', async () => {
      // Create a role with users.create
      const role = await createRole({
        name: 'Shrinking Role',
        permissions: {
          users: { view: true, create: true, edit: false, delete: false },
        },
        dataScope: { users: DataScope.ALL },
        dealStageTransitions: [],
        priority: 25,
      });

      const user = await createUser({
        email: 'shrinking@test.com',
        firstName: 'Shrinking',
        lastName: 'User',
        roleId: role.id,
        department: 'HVAC',
      });

      const caller = makeJwtUser(user, role.id);

      // Verify create works
      const allowedRes = await request(httpServer)
        .post('/api/users')
        .set('x-test-user', createTestUserHeader(caller))
        .send({
          email: 'allowed@test.com',
          firstName: 'Allowed',
          lastName: 'User',
          roleId: 'role-technician',
          department: 'HVAC',
        });

      expect(allowedRes.status).toBe(201);

      // Revoke users.create
      await request(httpServer)
        .put(`/api/users/roles/${role.id}`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: {
            users: { view: true, create: false, edit: false, delete: false },
          },
        });

      // Re-seed role permissions in Redis after revocation
      await seedRolePermissionsInRedis(role.id);

      // Now create should be blocked
      const blockedRes = await request(httpServer)
        .post('/api/users')
        .set('x-test-user', createTestUserHeader(caller))
        .send({
          email: 'blocked@test.com',
          firstName: 'Blocked',
          lastName: 'User',
          roleId: 'role-technician',
          department: 'HVAC',
        });

      expect(blockedRes.status).toBe(403);
    });
  });

  describe('authentication', () => {
    it('missing auth header returns 401', async () => {
      const res = await request(httpServer).get('/api/users');
      expect(res.status).toBe(401);
    });

    it('empty auth header returns 401', async () => {
      const res = await request(httpServer)
        .get('/api/users')
        .set('x-test-user', '');

      expect(res.status).toBe(401);
    });
  });
});
