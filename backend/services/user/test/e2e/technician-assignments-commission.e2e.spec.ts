import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
} from './setup';

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

describe('Technician Assignments & Commission API (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const admin: JwtUser = { id: 'admin-1', cognitoSub: 'c-a', email: 'a@t.com', roleId: 'role-admin', department: 'HVAC' };
  const tech: JwtUser = { id: 'tech-1', cognitoSub: 'c-t', email: 't@t.com', roleId: 'role-technician', department: 'HVAC' };
  const tech2: JwtUser = { id: 'tech-2', cognitoSub: 'c-t2', email: 't2@t.com', roleId: 'role-technician', department: 'HVAC' };

  // Catalog ids live in deal-service; e2e just needs stable strings to link.
  const JT = 'jt-locksmith';
  const SA = 'sa-atlanta';

  const base = '/api/users/technicians';
  const hdr = (u: JwtUser) => ['x-test-user', createTestUserHeader(u)] as const;

  beforeAll(async () => {
    app = await setupApp();
    http = app.getHttpServer();
  });
  afterAll(async () => teardownApp());
  beforeEach(async () => cleanupData());

  /** Technician proposes one job type and one service area. */
  async function proposeBoth(u = tech) {
    await request(http).post(`${base}/${u.id}/job-types/propose`).set(...hdr(u)).send({ ids: [JT] }).expect(201);
    await request(http).post(`${base}/${u.id}/service-areas/propose`).set(...hdr(u)).send({ ids: [SA] }).expect(201);
  }

  describe('assignments', () => {
    it('technician proposes a job type', async () => {
      const res = await request(http).post(`${base}/${tech.id}/job-types/propose`).set(...hdr(tech)).send({ ids: [JT] });
      expect(res.status).toBe(201);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0]).toMatchObject({ catalogId: JT, status: 'pending' });
    });

    it('forbids proposing for another technician', async () => {
      const res = await request(http).post(`${base}/${tech2.id}/job-types/propose`).set(...hdr(tech)).send({ ids: [JT] });
      expect(res.status).toBe(403);
    });

    it('technician cannot approve (lacks job_types.approve)', async () => {
      await proposeBoth();
      const res = await request(http).post(`${base}/${tech.id}/job-types/${JT}/approve`).set(...hdr(tech)).send({});
      expect(res.status).toBe(403);
    });

    it('manager approves both; technician becomes assignable; onboarding reflects it', async () => {
      await proposeBoth();
      await request(http).post(`${base}/${tech.id}/job-types/${JT}/approve`).set(...hdr(admin)).send({ comments: 'ok' }).expect(201);
      await request(http).post(`${base}/${tech.id}/service-areas/${SA}/approve`).set(...hdr(admin)).send({ comments: 'ok' }).expect(201);

      const ob = await request(http).get(`${base}/${tech.id}/onboarding-status`).set(...hdr(admin));
      expect(ob.body.data.checklist.assignmentsApproved).toBe(true);
    });

    it('manager direct-assigns a job type (skips propose→approve)', async () => {
      const res = await request(http).post(`${base}/${tech.id}/job-types`).set(...hdr(admin)).send({ ids: [JT] });
      expect(res.status).toBe(201);
      expect(res.body.data[0]).toMatchObject({ catalogId: JT, status: 'approved' });
    });

    it('manager sees pending across techs; technician cannot', async () => {
      await proposeBoth();
      const mgr = await request(http).get(`${base}/assignments/pending`).set(...hdr(admin));
      expect(mgr.status).toBe(200);
      expect(mgr.body.data.jobTypes.length + mgr.body.data.serviceAreas.length).toBeGreaterThanOrEqual(2);

      const denied = await request(http).get(`${base}/assignments/pending`).set(...hdr(tech));
      expect(denied.status).toBe(403);
    });

    it('reject requires a comment', async () => {
      await proposeBoth();
      const noComment = await request(http).post(`${base}/${tech.id}/job-types/${JT}/reject`).set(...hdr(admin)).send({});
      expect(noComment.status).toBe(400);
      const withComment = await request(http).post(`${base}/${tech.id}/job-types/${JT}/reject`).set(...hdr(admin)).send({ comments: 'no cert' });
      expect(withComment.status).toBe(201);
      expect(withComment.body.data.status).toBe('rejected');
    });

    it('manager revokes an approved job type; technician cannot', async () => {
      await proposeBoth();
      await request(http).post(`${base}/${tech.id}/job-types/${JT}/approve`).set(...hdr(admin)).send({}).expect(201);

      const denied = await request(http).delete(`${base}/${tech.id}/job-types/${JT}`).set(...hdr(tech));
      expect(denied.status).toBe(403);
      const ok = await request(http).delete(`${base}/${tech.id}/job-types/${JT}`).set(...hdr(admin));
      expect(ok.status).toBe(200);
    });
  });

  describe('commission', () => {
    it('manager sets commission; technician cannot', async () => {
      const denied = await request(http).post(`${base}/${tech.id}/commission`).set(...hdr(tech)).send({ baseRatePct: 40 });
      expect(denied.status).toBe(403);

      const ok = await request(http).post(`${base}/${tech.id}/commission`).set(...hdr(admin)).send({ baseRatePct: 40 });
      expect(ok.status).toBe(201);
      expect(ok.body.data).toMatchObject({ baseRatePct: 40, creditCardFeePct: 3, achFeePct: 0 });
    });

    it('technician views own commission but not another’s', async () => {
      await request(http).post(`${base}/${tech.id}/commission`).set(...hdr(admin)).send({ baseRatePct: 40 }).expect(201);

      const own = await request(http).get(`${base}/${tech.id}/commission`).set(...hdr(tech));
      expect(own.status).toBe(200);
      const other = await request(http).get(`${base}/${tech2.id}/commission`).set(...hdr(tech));
      expect(other.status).toBe(403);
    });

    it('returns 404 when no commission config exists', async () => {
      const res = await request(http).get(`${base}/${tech2.id}/commission`).set(...hdr(admin));
      expect(res.status).toBe(404);
    });

    it('calculates the EPIC-6 payout ($100.30 by card)', async () => {
      await request(http).post(`${base}/${tech.id}/commission`).set(...hdr(admin)).send({ baseRatePct: 40 }).expect(201);
      const res = await request(http)
        .get(`${base}/${tech.id}/commission/calculate?revenue=350&tax=28&partsCost=45&paidByCard=true`)
        .set(...hdr(admin));
      expect(res.status).toBe(200);
      expect(res.body.data.netPayout).toBe(100.3);
    });

    it('keeps history and reflects commissionSet in onboarding', async () => {
      await request(http).post(`${base}/${tech.id}/commission`).set(...hdr(admin)).send({ baseRatePct: 40, effectiveDate: '2026-01-01T00:00:00.000Z' }).expect(201);
      await request(http).post(`${base}/${tech.id}/commission`).set(...hdr(admin)).send({ baseRatePct: 45, effectiveDate: '2026-06-01T00:00:00.000Z' }).expect(201);

      const hist = await request(http).get(`${base}/${tech.id}/commission/history`).set(...hdr(admin));
      expect(hist.body.data.map((h: { baseRatePct: number }) => h.baseRatePct)).toEqual([45, 40]);

      const ob = await request(http).get(`${base}/${tech.id}/onboarding-status`).set(...hdr(admin));
      expect(ob.body.data.checklist.commissionSet).toBe(true);
    });
  });
});
