import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
} from './setup';

// Route all repositories at the shared test table.
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
  JOB_TYPE_SK_PREFIX: 'JOBTYPE#',
  SERVICE_AREA_SK_PREFIX: 'AREA#',
  GSI4_NAME: 'SkillStatusIndex',
  jobTypeStatusGsiPk: (s: string) => `JOBTYPE_STATUS#${s}`,
  serviceAreaStatusGsiPk: (s: string) => `AREA_STATUS#${s}`,
  COMMISSION_SK_PREFIX: 'COMMISSION#',
}));

describe('Technicians API (e2e)', () => {
  let app: INestApplication;
  let httpServer: ReturnType<INestApplication['getHttpServer']>;

  const admin: JwtUser = {
    id: 'admin-1',
    cognitoSub: 'c-admin',
    email: 'admin@test.com',
    roleId: 'role-admin',
    department: 'HVAC',
  };
  const dispatcher: JwtUser = {
    id: 'disp-1',
    cognitoSub: 'c-disp',
    email: 'disp@test.com',
    roleId: 'role-dispatcher',
    department: 'HVAC',
  };
  const tech: JwtUser = {
    id: 'tech-1',
    cognitoSub: 'c-tech',
    email: 'tech@test.com',
    roleId: 'role-technician',
    department: 'HVAC',
  };
  const otherTech: JwtUser = {
    id: 'tech-2',
    cognitoSub: 'c-tech2',
    email: 'tech2@test.com',
    roleId: 'role-technician',
    department: 'HVAC',
  };

  const base = '/api/users/technicians';
  const hdr = (u: JwtUser) => ['x-test-user', createTestUserHeader(u)] as const;

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

  it('rejects unauthenticated requests', async () => {
    await request(httpServer).get(`${base}`).expect(401);
  });

  describe('self-service (technician)', () => {
    it('lets a technician create/update their own profile (self-fill)', async () => {
      const res = await request(httpServer)
        .put(`${base}/${tech.id}/profile`)
        .set(...hdr(tech))
        .send({
          phone: '404-555-0123',
          homeAddress: { line1: '1 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
        });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ userId: 'tech-1', phone: '404-555-0123' });
    });

    it('lets a technician read their own profile', async () => {
      await request(httpServer)
        .put(`${base}/${tech.id}/profile`)
        .set(...hdr(tech))
        .send({ phone: '111' })
        .expect(200);

      const res = await request(httpServer)
        .get(`${base}/${tech.id}/profile`)
        .set(...hdr(tech));
      expect(res.status).toBe(200);
      expect(res.body.data.userId).toBe('tech-1');
    });

    it('forbids a technician from setting operational fields', async () => {
      const res = await request(httpServer)
        .put(`${base}/${tech.id}/profile`)
        .set(...hdr(tech))
        .send({ laborCostPerHour: 50 });
      expect(res.status).toBe(403);
    });

    it('forbids a technician from reading another technician profile', async () => {
      const res = await request(httpServer)
        .get(`${base}/${otherTech.id}/profile`)
        .set(...hdr(tech));
      expect(res.status).toBe(403);
    });
  });

  describe('manager (admin)', () => {
    it('sets operational fields and activates a technician', async () => {
      const res = await request(httpServer)
        .put(`${base}/${tech.id}/profile`)
        .set(...hdr(admin))
        .send({ status: 'active', laborCostPerHour: 45, callMaskingEnabled: true });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        status: 'active',
        laborCostPerHour: 45,
        callMaskingEnabled: true,
      });
    });

    it('lists technicians and filters by status', async () => {
      await request(httpServer)
        .put(`${base}/${tech.id}/profile`)
        .set(...hdr(admin))
        .send({ status: 'active' })
        .expect(200);
      await request(httpServer)
        .put(`${base}/${otherTech.id}/profile`)
        .set(...hdr(admin))
        .send({ status: 'pending' })
        .expect(200);

      const all = await request(httpServer).get(base).set(...hdr(admin));
      expect(all.status).toBe(200);
      expect(all.body.data.map((p: { userId: string }) => p.userId).sort()).toEqual([
        'tech-1',
        'tech-2',
      ]);

      const active = await request(httpServer).get(`${base}?status=active`).set(...hdr(admin));
      expect(active.body.data.map((p: { userId: string }) => p.userId)).toEqual(['tech-1']);
    });
  });

  describe('dispatcher', () => {
    it('can view the technician list (privileged)', async () => {
      await request(httpServer).get(base).set(...hdr(dispatcher)).expect(200);
    });

    it('cannot edit a profile (lacks technicians.edit)', async () => {
      const res = await request(httpServer)
        .put(`${base}/${tech.id}/profile`)
        .set(...hdr(dispatcher))
        .send({ phone: '222' });
      expect(res.status).toBe(403);
    });
  });

  describe('onboarding status', () => {
    it('reflects partial completion', async () => {
      await request(httpServer)
        .put(`${base}/${tech.id}/profile`)
        .set(...hdr(tech))
        .send({ phone: '404-555-0123' })
        .expect(200);

      const res = await request(httpServer)
        .get(`${base}/${tech.id}/onboarding-status`)
        .set(...hdr(tech));
      expect(res.status).toBe(200);
      expect(res.body.data.totalSteps).toBe(3);
      expect(res.body.data.checklist.profileComplete).toBe(false);
      expect(res.body.data.checklist.assignmentsApproved).toBe(false);
    });
  });
});
