import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser, DataScope } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
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

describe('Roles API (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

  const superAdminUser: JwtUser = {
    id: 'super-admin-1',
    cognitoSub: 'cognito-super',
    email: 'super@test.com',
    roleId: 'role-super-admin',
    department: 'Engineering',
  };

  const adminUser: JwtUser = {
    id: 'admin-1',
    cognitoSub: 'cognito-admin',
    email: 'admin@test.com',
    roleId: 'role-admin',
    department: 'Engineering',
  };

  const techUser: JwtUser = {
    id: 'tech-1',
    cognitoSub: 'cognito-tech',
    email: 'tech@test.com',
    roleId: 'role-technician',
    department: 'HVAC',
  };

  const createRoleBody = {
    name: 'Custom Dispatcher',
    description: 'Custom dispatcher role for testing',
    permissions: {
      deals: { view: true, create: true, edit: true, delete: false },
      users: { view: true, create: false, edit: false, delete: false },
    },
    dataScope: {
      deals: DataScope.DEPARTMENT,
      users: DataScope.DEPARTMENT,
    },
    dealStageTransitions: ['lead->qualified', 'qualified->proposal'],
    priority: 30,
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

  // Helper to create a role via API
  async function createRole(body = createRoleBody, caller = superAdminUser) {
    return request(httpServer)
      .post('/api/users/roles')
      .set('x-test-user', createTestUserHeader(caller))
      .send(body);
  }

  // Helper to create a user via API
  async function createUser(
    body: Record<string, unknown>,
    caller = superAdminUser,
  ) {
    return request(httpServer)
      .post('/api/users')
      .set('x-test-user', createTestUserHeader(caller))
      .send(body);
  }

  describe('POST /api/users/roles', () => {
    it('should create custom role (201)', async () => {
      const res = await createRole();

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.name).toBe('Custom Dispatcher');
      expect(res.body.data.permissions.deals.view).toBe(true);
      expect(res.body.data.isSystem).toBe(false);
      expect(res.body.data.priority).toBe(30);
    });

    it('should reject duplicate role name (409)', async () => {
      await createRole();
      const res = await createRole();

      expect(res.status).toBe(409);
    });

    it('should return 400 on invalid body (missing name)', async () => {
      const res = await request(httpServer)
        .post('/api/users/roles')
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({ ...createRoleBody, name: undefined });

      expect(res.status).toBe(400);
    });

    it('should return 403 when technician tries to create role', async () => {
      const res = await createRole(createRoleBody, techUser);
      expect(res.status).toBe(403);
    });

    it('should return 401 without auth header', async () => {
      const res = await request(httpServer)
        .post('/api/users/roles')
        .send(createRoleBody);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/users/roles', () => {
    it('should list all roles', async () => {
      await createRole();
      await createRole({
        ...createRoleBody,
        name: 'Second Role',
        priority: 20,
      });

      const res = await request(httpServer)
        .get('/api/users/roles')
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // 5 seeded system roles + 2 custom roles = 7
      expect(res.body.data.length).toBe(7);
    });

    it('should return only system roles when no custom roles exist', async () => {
      const res = await request(httpServer)
        .get('/api/users/roles')
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      // 5 seeded system roles exist
      expect(res.body.data.length).toBe(5);
      expect(res.body.data.every((r: { isSystem: boolean }) => r.isSystem)).toBe(true);
    });
  });

  describe('GET /api/users/roles/:id', () => {
    it('should get role by id', async () => {
      const createRes = await createRole();
      const roleId = createRes.body.data.id;

      const res = await request(httpServer)
        .get(`/api/users/roles/${roleId}`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(roleId);
      expect(res.body.data.name).toBe('Custom Dispatcher');
    });

    it('should return 404 for nonexistent role', async () => {
      const res = await request(httpServer)
        .get('/api/users/roles/nonexistent-id')
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(404);
    });
  });

  describe('PUT /api/users/roles/:id', () => {
    it('should update role name and permissions', async () => {
      const createRes = await createRole();
      const roleId = createRes.body.data.id;

      const res = await request(httpServer)
        .put(`/api/users/roles/${roleId}`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({
          name: 'Updated Dispatcher',
          permissions: {
            deals: { view: true, create: true, edit: true, delete: true },
            users: { view: true, create: true, edit: false, delete: false },
          },
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Dispatcher');
      expect(res.body.data.permissions.deals.delete).toBe(true);
      expect(res.body.data.permissions.users.create).toBe(true);
    });

    it('should reject editing system Super Admin role (403)', async () => {
      // First, we need to find or seed the system super admin role
      // Attempt to create a system-like role, then try to update it
      // In practice, system roles are seeded. For this test, create a role
      // and then try to update it if it's marked as system.
      // Since we can't create system roles via API, we test against a known
      // system role ID if one exists after seeding, or we verify the guard works.
      const createRes = await createRole();
      const roleId = createRes.body.data.id;

      // First verify we can update a non-system role
      const updateRes = await request(httpServer)
        .put(`/api/users/roles/${roleId}`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({ name: 'Renamed' });

      expect(updateRes.status).toBe(200);

      // Attempt to update the actual system super_admin role (seeded)
      // This role ID would be 'role-super-admin' or similar from seed data
      const sysRes = await request(httpServer)
        .put('/api/users/roles/role-super-admin')
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({ name: 'Hacked Admin' });

      // Should be 403 (forbidden to edit system role)
      expect(sysRes.status).toBe(403);
    });

    it('should return 404 for nonexistent role', async () => {
      const res = await request(httpServer)
        .put('/api/users/roles/nonexistent-id')
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({ name: 'Ghost' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/users/roles/:id', () => {
    it('should delete custom role (200)', async () => {
      const createRes = await createRole();
      const roleId = createRes.body.data.id;

      const res = await request(httpServer)
        .delete(`/api/users/roles/${roleId}`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);

      // Verify role is gone
      const getRes = await request(httpServer)
        .get(`/api/users/roles/${roleId}`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(getRes.status).toBe(404);
    });

    it('should reject deleting system role (403)', async () => {
      // Attempt to delete a system role (seeded)
      const res = await request(httpServer)
        .delete('/api/users/roles/role-super-admin')
        .set('x-test-user', createTestUserHeader(superAdminUser));

      // 403 Forbidden — cannot delete a system role
      expect(res.status).toBe(403);
    });

    it('should reject deleting role with assigned users (409)', async () => {
      // Create a role
      const roleRes = await createRole();
      const roleId = roleRes.body.data.id;

      // Create a user assigned to this role
      await createUser({
        email: 'assigned@test.com',
        firstName: 'Assigned',
        lastName: 'User',
        roleId: roleId,
        department: 'HVAC',
      });

      // Attempt to delete the role
      const res = await request(httpServer)
        .delete(`/api/users/roles/${roleId}`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(409);
    });

    it('should return 403 when non-admin tries to delete', async () => {
      const createRes = await createRole();
      const roleId = createRes.body.data.id;

      const res = await request(httpServer)
        .delete(`/api/users/roles/${roleId}`)
        .set('x-test-user', createTestUserHeader(techUser));

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/users/roles/:id/users', () => {
    it('should list users with this role', async () => {
      const roleRes = await createRole();
      const roleId = roleRes.body.data.id;

      // Create users with this role
      await createUser({
        email: 'user1@test.com',
        firstName: 'User',
        lastName: 'One',
        roleId: roleId,
        department: 'HVAC',
      });
      await createUser({
        email: 'user2@test.com',
        firstName: 'User',
        lastName: 'Two',
        roleId: roleId,
        department: 'Plumbing',
      });

      const res = await request(httpServer)
        .get(`/api/users/roles/${roleId}/users`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBe(2);
    });

    it('should return empty array for role with no users', async () => {
      const roleRes = await createRole();
      const roleId = roleRes.body.data.id;

      const res = await request(httpServer)
        .get(`/api/users/roles/${roleId}/users`)
        .set('x-test-user', createTestUserHeader(superAdminUser));

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  describe('PUT /api/users/:id/role', () => {
    it('should assign role to user', async () => {
      // Create two roles
      const role1Res = await createRole();
      const role1Id = role1Res.body.data.id;

      const role2Res = await createRole({
        ...createRoleBody,
        name: 'Second Role',
        priority: 20,
      });
      const role2Id = role2Res.body.data.id;

      // Create user with role1
      const userRes = await createUser({
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        roleId: role1Id,
        department: 'HVAC',
      });
      const userId = userRes.body.data.id;

      // Reassign to role2
      const res = await request(httpServer)
        .put(`/api/users/${userId}/role`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({ roleId: role2Id });

      expect(res.status).toBe(200);
      expect(res.body.data.roleId).toBe(role2Id);
    });

    it('should protect last super admin (403)', async () => {
      // Create the super admin user in the system
      const userRes = await createUser({
        email: 'superadmin@test.com',
        firstName: 'Super',
        lastName: 'Admin',
        roleId: 'role-super-admin',
        department: 'Engineering',
      });
      const userId = userRes.body.data.id;

      // Create a regular role
      const roleRes = await createRole();
      const roleId = roleRes.body.data.id;

      // Attempt to change the only super admin to a regular role
      // Service throws ForbiddenException (cannot change own role)
      // because superAdminUser.id === 'super-admin-1' but the created user has a different id
      // Actually, the caller is superAdminUser (id: 'super-admin-1') and the target is a different user.
      // The last super admin check should trigger since this is the only user with role-super-admin.
      const res = await request(httpServer)
        .put(`/api/users/${userId}/role`)
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({ roleId: roleId });

      // 403 Forbidden — cannot remove the last Super Admin
      expect(res.status).toBe(403);
    });

    it('should return 404 for nonexistent user', async () => {
      const roleRes = await createRole();
      const roleId = roleRes.body.data.id;

      const res = await request(httpServer)
        .put('/api/users/nonexistent-id/role')
        .set('x-test-user', createTestUserHeader(superAdminUser))
        .send({ roleId: roleId });

      expect(res.status).toBe(404);
    });

    it('should return 403 when technician tries to reassign roles', async () => {
      const roleRes = await createRole();
      const roleId = roleRes.body.data.id;

      const userRes = await createUser({
        email: 'user@test.com',
        firstName: 'Test',
        lastName: 'User',
        roleId: roleId,
        department: 'HVAC',
      });
      const userId = userRes.body.data.id;

      const res = await request(httpServer)
        .put(`/api/users/${userId}/role`)
        .set('x-test-user', createTestUserHeader(techUser))
        .send({ roleId: roleId });

      expect(res.status).toBe(403);
    });
  });
});
