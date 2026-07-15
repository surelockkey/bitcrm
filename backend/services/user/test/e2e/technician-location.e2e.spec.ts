import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, cleanupData, createTestUserHeader } from './setup';

// Route all repositories at the shared test table (the PermissionGuard reads roles).
jest.mock('../../src/users/constants/dynamo.constants', () => ({
  USERS_TABLE: 'BitCRM_Users_Test',
  GSI1_NAME: 'RoleIndex',
  GSI2_NAME: 'DepartmentIndex',
}));
jest.mock('../../src/roles/constants/dynamo.constants', () => ({
  ROLES_TABLE: 'BitCRM_Users_Test',
  ROLES_GSI1_NAME: 'RoleIndex',
}));
jest.mock('../../src/technicians/constants/dynamo.constants', () => ({
  TECHNICIANS_TABLE: 'BitCRM_Users_Test',
  GSI3_NAME: 'TechnicianIndex',
  TECHNICIAN_GSI_PK: 'TECHNICIAN',
  PROFILE_SK: 'TECH_PROFILE',
  SKILL_SK_PREFIX: 'SKILL#',
  GSI4_NAME: 'SkillStatusIndex',
  skillStatusGsiPk: (s: string) => `SKILL_STATUS#${s}`,
  COMMISSION_SK_PREFIX: 'COMMISSION#',
}));

const BASE = '/api/users/technicians';

const admin: JwtUser = {
  id: 'admin-1', cognitoSub: 'c', email: 'a@t.com', roleId: 'role-admin', department: 'HVAC',
};
const dispatcher: JwtUser = {
  id: 'disp-1', cognitoSub: 'c', email: 'd@t.com', roleId: 'role-dispatcher', department: 'HVAC',
};
const tech: JwtUser = {
  id: 'tech-1', cognitoSub: 'c', email: 't@t.com', roleId: 'role-technician', department: 'HVAC',
};
const otherTech: JwtUser = {
  id: 'tech-2', cognitoSub: 'c', email: 't2@t.com', roleId: 'role-technician', department: 'HVAC',
};

describe('Technician Location (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await setupApp(); });
  afterAll(async () => { await teardownApp(); });
  afterEach(async () => { await cleanupData(); });

  const post = (as: JwtUser, id: string, body: Record<string, number>) =>
    request(app.getHttpServer())
      .post(`${BASE}/${id}/location`)
      .set('x-test-user', createTestUserHeader(as))
      .send(body);

  it('lets a technician report their own location', async () => {
    const res = await post(tech, 'tech-1', { lat: 33.749, lng: -84.388, accuracy: 10 }).expect(201);
    expect(res.body.data).toMatchObject({ userId: 'tech-1', lat: 33.749, lng: -84.388 });
    expect(res.body.data.updatedAt).toEqual(expect.any(String));
  });

  it('forbids reporting another technician’s location', async () => {
    await post(tech, 'tech-2', { lat: 1, lng: 2 }).expect(403);
  });

  it('rejects out-of-range coordinates', async () => {
    await post(tech, 'tech-1', { lat: 999, lng: -84.388 }).expect(400);
  });

  it('requires authentication', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/tech-1/location`)
      .send({ lat: 1, lng: 2 })
      .expect(401);
  });

  it('shows online technicians to a dispatcher', async () => {
    await post(tech, 'tech-1', { lat: 1, lng: 1 }).expect(201);
    await post(otherTech, 'tech-2', { lat: 2, lng: 2 }).expect(201);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/locations`)
      .set('x-test-user', createTestUserHeader(dispatcher))
      .expect(200);

    expect(res.body.data.map((l: { userId: string }) => l.userId).sort()).toEqual(['tech-1', 'tech-2']);
  });

  it('hides the location list from a field technician', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/locations`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(403);
  });

  it('returns an empty list when nobody is online', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/locations`)
      .set('x-test-user', createTestUserHeader(admin))
      .expect(200);
    expect(res.body.data).toEqual([]);
  });

  it('lets a technician go offline', async () => {
    await post(tech, 'tech-1', { lat: 1, lng: 1 }).expect(201);
    await request(app.getHttpServer())
      .delete(`${BASE}/tech-1/location`)
      .set('x-test-user', createTestUserHeader(tech))
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/locations`)
      .set('x-test-user', createTestUserHeader(admin))
      .expect(200);
    expect(res.body.data).toEqual([]);
  });
});
