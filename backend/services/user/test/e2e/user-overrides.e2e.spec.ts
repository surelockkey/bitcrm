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

describe('User permission overrides (e2e)', () => {
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

  // Seed a base role and user for override tests
  async function seedRoleAndUser() {
    const role = await createRole({
      name: 'Base Role',
      permissions: {
        deals: { view: true, create: false, edit: false, delete: false },
        users: { view: true, create: false, edit: false, delete: false },
      },
      dataScope: {
        deals: DataScope.DEPARTMENT,
        users: DataScope.DEPARTMENT,
      },
      dealStageTransitions: ['lead->qualified'],
      priority: 20,
    });

    const user = await createUser({
      email: 'override-test@test.com',
      firstName: 'Override',
      lastName: 'Test',
      roleId: role.id,
      department: 'HVAC',
    });

    return { role, user };
  }

  describe('PUT /api/users/:id/permissions', () => {
    it('should set permission overrides (200)', async () => {
      const { user } = await seedRoleAndUser();

      const res = await request(httpServer)
        .put(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: {
            deals: { create: true, edit: true },
          },
          dataScope: {
            deals: DataScope.ALL,
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should set stage transition overrides', async () => {
      const { user } = await seedRoleAndUser();

      const res = await request(httpServer)
        .put(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          dealStageTransitions: ['*->*'],
        });

      expect(res.status).toBe(200);
    });

    it('should return 404 for nonexistent user', async () => {
      const res = await request(httpServer)
        .put('/api/users/nonexistent-id/permissions')
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: { deals: { create: true } },
        });

      expect(res.status).toBe(404);
    });

    it('should return 403 when non-admin tries to set overrides', async () => {
      const { user, role } = await seedRoleAndUser();

      const techCaller: JwtUser = {
        id: user.id,
        cognitoSub: user.cognitoSub,
        email: user.email,
        roleId: role.id,
        department: 'HVAC',
      };

      const res = await request(httpServer)
        .put(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(techCaller))
        .send({
          permissions: { deals: { delete: true } },
        });

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/users/:id/permissions', () => {
    it('should return resolved permissions showing role base without overrides', async () => {
      const { user, role } = await seedRoleAndUser();

      const res = await request(httpServer)
        .get(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.roleId).toBe(role.id);
      expect(res.body.data.roleName).toBe('Base Role');
      expect(res.body.data.hasOverrides).toBe(false);
      expect(res.body.data.permissions.deals.view).toBe(true);
      expect(res.body.data.permissions.deals.create).toBe(false);
      expect(res.body.data.dataScope.deals).toBe(DataScope.DEPARTMENT);
      expect(res.body.data.dealStageTransitions).toEqual(['lead->qualified']);
    });

    it('should return resolved permissions with overrides merged', async () => {
      const { user, role } = await seedRoleAndUser();

      // Set overrides
      await request(httpServer)
        .put(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: {
            deals: { create: true, edit: true },
          },
          dataScope: {
            deals: DataScope.ALL,
          },
        });

      // Get resolved permissions
      const res = await request(httpServer)
        .get(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.hasOverrides).toBe(true);
      expect(res.body.data.roleId).toBe(role.id);
      // Overridden: create and edit now true
      expect(res.body.data.permissions.deals.create).toBe(true);
      expect(res.body.data.permissions.deals.edit).toBe(true);
      // From role base: view still true, delete still false
      expect(res.body.data.permissions.deals.view).toBe(true);
      expect(res.body.data.permissions.deals.delete).toBe(false);
      // Data scope overridden
      expect(res.body.data.dataScope.deals).toBe(DataScope.ALL);
      // Users scope unchanged from role
      expect(res.body.data.dataScope.users).toBe(DataScope.DEPARTMENT);
    });

    it('should return 404 for nonexistent user', async () => {
      const res = await request(httpServer)
        .get('/api/users/nonexistent-id/permissions')
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/users/:id/permissions', () => {
    it('should clear overrides (200)', async () => {
      const { user } = await seedRoleAndUser();

      // Set overrides first
      await request(httpServer)
        .put(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: { deals: { create: true } },
        });

      // Clear overrides
      const res = await request(httpServer)
        .delete(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
    });

    it('should revert to role base after clearing overrides', async () => {
      const { user } = await seedRoleAndUser();

      // Set overrides
      await request(httpServer)
        .put(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: { deals: { create: true, edit: true } },
          dataScope: { deals: DataScope.ALL },
        });

      // Clear overrides
      await request(httpServer)
        .delete(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      // Verify permissions match role base
      const res = await request(httpServer)
        .get(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.hasOverrides).toBe(false);
      expect(res.body.data.permissions.deals.create).toBe(false);
      expect(res.body.data.permissions.deals.edit).toBe(false);
      expect(res.body.data.dataScope.deals).toBe(DataScope.DEPARTMENT);
    });

    it('should return 404 for nonexistent user', async () => {
      const res = await request(httpServer)
        .delete('/api/users/nonexistent-id/permissions')
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(404);
    });
  });

  describe('role update interaction with overrides', () => {
    it('role update propagates to user without overrides', async () => {
      const { user, role } = await seedRoleAndUser();

      // Get permissions before role update
      const beforeRes = await request(httpServer)
        .get(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(beforeRes.body.data.permissions.deals.create).toBe(false);

      // Update the role to add deals.create
      await request(httpServer)
        .put(`/api/users/roles/${role.id}`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: {
            deals: { view: true, create: true, edit: false, delete: false },
            users: { view: true, create: false, edit: false, delete: false },
          },
        });

      // Get permissions after role update -- should reflect the change
      const afterRes = await request(httpServer)
        .get(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(afterRes.body.data.permissions.deals.create).toBe(true);
    });

    it('role update does NOT overwrite user overrides', async () => {
      const { user, role } = await seedRoleAndUser();

      // Set user override: deals.edit = true
      await request(httpServer)
        .put(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: {
            deals: { edit: true },
          },
        });

      // Update the role (change deals.create, but NOT deals.edit)
      await request(httpServer)
        .put(`/api/users/roles/${role.id}`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          permissions: {
            deals: { view: true, create: true, edit: false, delete: false },
            users: { view: true, create: false, edit: false, delete: false },
          },
        });

      // Get resolved permissions
      const res = await request(httpServer)
        .get(`/api/users/${user.id}/permissions`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.hasOverrides).toBe(true);
      // From role update
      expect(res.body.data.permissions.deals.create).toBe(true);
      // User override preserved (role says false, but user override says true)
      expect(res.body.data.permissions.deals.edit).toBe(true);
      // From role base
      expect(res.body.data.permissions.deals.view).toBe(true);
      expect(res.body.data.permissions.deals.delete).toBe(false);
    });
  });
});
