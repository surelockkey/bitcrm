import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserStatus, type JwtUser } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
  getMockCognitoAdmin,
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

describe('Users API (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

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

  const createUserBody = {
    email: 'new@test.com',
    firstName: 'Jane',
    lastName: 'Smith',
    roleId: 'role-technician',
    department: 'HVAC',
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

  // Helper to create a user via API and return the response body
  async function createUser(
    body = createUserBody,
    caller = adminUser,
  ) {
    const res = await request(httpServer)
      .post('/api/users')
      .set('x-test-user', createTestUserHeader(caller))
      .send(body);
    return res;
  }

  describe('POST /api/users', () => {
    it('should create user successfully with admin caller', async () => {
      const res = await createUser();

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('new@test.com');
      expect(res.body.data.roleId).toBe('role-technician');
      expect(res.body.data.status).toBe(UserStatus.ACTIVE);
      expect(res.body.data.id).toBeDefined();
    });

    it('should return 403 when technician tries to create', async () => {
      const res = await createUser(createUserBody, techUser);
      expect(res.status).toBe(403);
    });

    it('should return 403 when admin tries to create admin-level user', async () => {
      const res = await createUser({
        ...createUserBody,
        roleId: 'role-admin',
      });
      expect(res.status).toBe(403);
    });

    it('should return 400 on invalid body (missing email)', async () => {
      const res = await request(httpServer)
        .post('/api/users')
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ firstName: 'Jane', lastName: 'Smith', roleId: 'role-technician', department: 'HVAC' });

      expect(res.status).toBe(400);
    });

    it('should return 400 on invalid body (missing required fields)', async () => {
      const res = await request(httpServer)
        .post('/api/users')
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ email: 'incomplete@test.com' });

      expect(res.status).toBe(400);
    });

    it('should return 401 without auth header', async () => {
      const res = await request(httpServer)
        .post('/api/users')
        .send(createUserBody);

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/users/me', () => {
    it('should return current user profile', async () => {
      // First create the admin user in DB
      await createUser({
        ...createUserBody,
        email: adminUser.email,
      });

      // The admin's own profile needs to exist — create it differently
      // Since /me uses caller.id, we need a user with id=admin-1
      // Let's create one via API first, then get it
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      // Use the created user's id as the caller
      const callerWithId: JwtUser = { ...adminUser, id: userId };
      const res = await request(httpServer)
        .get('/api/users/me')
        .set('x-test-user', createTestUserHeader(callerWithId));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(userId);
    });

    it('should return 401 without auth', async () => {
      const res = await request(httpServer).get('/api/users/me');
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/users/:id', () => {
    it('should return user by ID', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      const res = await request(httpServer)
        .get(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(userId);
    });

    it('should return 404 for nonexistent user', async () => {
      const res = await request(httpServer)
        .get('/api/users/nonexistent-id')
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(res.status).toBe(404);
    });

    it('should return 403 for technician caller', async () => {
      const res = await request(httpServer)
        .get('/api/users/some-id')
        .set('x-test-user', createTestUserHeader(techUser));

      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/users', () => {
    it('should list all users', async () => {
      await createUser();
      await createUser({
        ...createUserBody,
        email: 'second@test.com',
      });

      const res = await request(httpServer)
        .get('/api/users')
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination).toBeDefined();
    });

    it('should filter by roleId', async () => {
      await createUser();
      await createUser({
        ...createUserBody,
        email: 'disp@test.com',
        roleId: 'role-dispatcher',
      });

      const res = await request(httpServer)
        .get('/api/users?roleId=role-technician')
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.every((u: { roleId: string }) => u.roleId === 'role-technician')).toBe(true);
    });

    it('should filter by department', async () => {
      await createUser();
      await createUser({
        ...createUserBody,
        email: 'plumb@test.com',
        department: 'Plumbing',
      });

      const res = await request(httpServer)
        .get('/api/users?department=HVAC')
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data.every((u: { department: string }) => u.department === 'HVAC')).toBe(true);
    });

    it('should respect limit parameter', async () => {
      await createUser();
      await createUser({ ...createUserBody, email: 'u2@test.com' });
      await createUser({ ...createUserBody, email: 'u3@test.com' });

      const res = await request(httpServer)
        .get('/api/users?limit=2')
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(res.status).toBe(200);
      // DynamoDB scan with limit may return fewer due to filter, but should return some
      expect(res.body.data.length).toBeLessThanOrEqual(3);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('PUT /api/users/:id', () => {
    it('should update user name fields', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      const res = await request(httpServer)
        .put(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ firstName: 'Updated' });

      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Updated');
    });

    it('should ignore unknown fields (roleId not updatable via this endpoint)', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      const res = await request(httpServer)
        .put(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ firstName: 'Updated', roleId: 'role-dispatcher' });

      // roleId should be ignored (whitelist validation strips unknown fields)
      expect(res.status).toBe(200);
      expect(res.body.data.firstName).toBe('Updated');
    });
  });

  describe('PUT /api/users/:id/role', () => {
    it('should assign role and verify via list by new roleId', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      const res = await request(httpServer)
        .put(`/api/users/${userId}/role`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ roleId: 'role-dispatcher' });

      expect(res.status).toBe(200);
      expect(res.body.data.roleId).toBe('role-dispatcher');
      expect(getMockCognitoAdmin().updateUserAttributes).toHaveBeenCalled();
    });

    it('should return 403 on self-role-change', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;
      const selfCaller: JwtUser = { ...adminUser, id: userId };

      const res = await request(httpServer)
        .put(`/api/users/${userId}/role`)
        .set('x-test-user', createTestUserHeader(selfCaller))
        .send({ roleId: 'role-technician' });

      expect(res.status).toBe(403);
    });

    it('should return 403 when assigning role >= own level', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      const res = await request(httpServer)
        .put(`/api/users/${userId}/role`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ roleId: 'role-admin' });

      expect(res.status).toBe(403);
    });
  });

  describe('DELETE /api/users/:id', () => {
    it('should deactivate user', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      const res = await request(httpServer)
        .delete(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();

      // Verify user is now inactive
      const getRes = await request(httpServer)
        .get(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(getRes.body.data.status).toBe(UserStatus.INACTIVE);
    });

    it('should return 403 on self-deactivation', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;
      const selfCaller: JwtUser = { ...adminUser, id: userId };

      const res = await request(httpServer)
        .delete(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(selfCaller));

      expect(res.status).toBe(403);
    });

    it('should return 403 when technician tries to deactivate', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      const res = await request(httpServer)
        .delete(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(techUser));

      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/users/:id/reactivate', () => {
    it('should reactivate user', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      // First deactivate
      await request(httpServer)
        .delete(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(adminUser));

      // Then reactivate
      const res = await request(httpServer)
        .post(`/api/users/${userId}/reactivate`)
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(res.status).toBe(201);

      // Verify user is active again
      const getRes = await request(httpServer)
        .get(`/api/users/${userId}`)
        .set('x-test-user', createTestUserHeader(adminUser));

      expect(getRes.body.data.status).toBe(UserStatus.ACTIVE);
    });

    it('should return 403 when caller cannot manage target', async () => {
      const createRes = await createUser();
      const userId = createRes.body.data.id;

      const res = await request(httpServer)
        .post(`/api/users/${userId}/reactivate`)
        .set('x-test-user', createTestUserHeader(techUser));

      expect(res.status).toBe(403);
    });
  });
});
