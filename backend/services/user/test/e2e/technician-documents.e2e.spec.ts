import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, cleanupData, createTestUserHeader } from './setup';

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
  DOC_SK_PREFIX: 'DOC#',
  SENSITIVE_SK: 'TECH_SENSITIVE',
  auditPk: (u: string) => `AUDIT#${u}`,
  documentS3Key: (u: string, d: string) => `technicians/${u}/${d}`,
}));

describe('Technician Documents & Sensitive API (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  const superAdmin: JwtUser = { id: 'sa-1', cognitoSub: 'c-sa', email: 'sa@t.com', roleId: 'role-super-admin', department: 'HVAC' };
  const admin: JwtUser = { id: 'admin-1', cognitoSub: 'c-a', email: 'a@t.com', roleId: 'role-admin', department: 'HVAC' };
  const manager: JwtUser = { id: 'mgr-1', cognitoSub: 'c-m', email: 'm@t.com', roleId: 'role-dept-manager', department: 'HVAC' };
  const dispatcher: JwtUser = { id: 'disp-1', cognitoSub: 'c-d', email: 'd@t.com', roleId: 'role-dispatcher', department: 'HVAC' };
  const tech: JwtUser = { id: 'tech-1', cognitoSub: 'c-t', email: 't@t.com', roleId: 'role-technician', department: 'HVAC' };
  const tech2: JwtUser = { id: 'tech-2', cognitoSub: 'c-t2', email: 't2@t.com', roleId: 'role-technician', department: 'HVAC' };

  const base = '/api/users/technicians';
  const hdr = (u: JwtUser) => ['x-test-user', createTestUserHeader(u)] as const;

  beforeAll(async () => {
    app = await setupApp();
    http = app.getHttpServer();
  });
  afterAll(async () => teardownApp());
  beforeEach(async () => cleanupData());

  describe('documents (S3, SSE-KMS, presigned)', () => {
    it('technician gets a presigned upload URL for their own document', async () => {
      const res = await request(http)
        .post(`${base}/${tech.id}/documents`)
        .set(...hdr(tech))
        .send({ docType: 'drivers_license_front', contentType: 'image/jpeg' });
      expect(res.status).toBe(201);
      expect(res.body.data.uploadUrl).toBe('https://s3.local/upload');
    });

    it('forbids uploading for another technician', async () => {
      const res = await request(http)
        .post(`${base}/${tech2.id}/documents`)
        .set(...hdr(tech))
        .send({ docType: 'profile_photo', contentType: 'image/png' });
      expect(res.status).toBe(403);
    });

    it('manager downloads (presigned) and an audit record is written', async () => {
      await request(http).post(`${base}/${tech.id}/documents`).set(...hdr(tech))
        .send({ docType: 'drivers_license_front', contentType: 'image/jpeg' }).expect(201);

      const dl = await request(http).get(`${base}/${tech.id}/documents/drivers_license_front`).set(...hdr(manager));
      expect(dl.status).toBe(200);
      expect(dl.body.data.downloadUrl).toBe('https://s3.local/download');

      const audit = await request(http).get(`${base}/${tech.id}/audit`).set(...hdr(manager));
      expect(audit.body.data.some((a: { action: string }) => a.action === 'document.viewed')).toBe(true);
    });

    it('dispatcher cannot view documents (lacks documents.view)', async () => {
      const res = await request(http).get(`${base}/${tech.id}/documents`).set(...hdr(dispatcher));
      expect(res.status).toBe(403);
    });

    it('only Admin+ can delete; manager is forbidden', async () => {
      await request(http).post(`${base}/${tech.id}/documents`).set(...hdr(tech))
        .send({ docType: 'bank_document', contentType: 'application/pdf' }).expect(201);

      const mgrDel = await request(http).delete(`${base}/${tech.id}/documents/bank_document`).set(...hdr(manager));
      expect(mgrDel.status).toBe(403);

      const adminDel = await request(http).delete(`${base}/${tech.id}/documents/bank_document`).set(...hdr(admin));
      expect(adminDel.status).toBe(200);
    });
  });

  describe('sensitive fields (KMS)', () => {
    it('technician sets SSN + bank; never returns plaintext to themselves', async () => {
      await request(http).put(`${base}/${tech.id}/sensitive`).set(...hdr(tech))
        .send({ ssn: '123-45-6789', bankAccount: '000111222333' }).expect(200);

      const own = await request(http).get(`${base}/${tech.id}/sensitive`).set(...hdr(tech));
      expect(own.status).toBe(200);
      expect(own.body.data.masked).toBe(true);
      expect(own.body.data.ssn).not.toContain('123-45');
      expect(own.body.data.ssn.endsWith('6789')).toBe(true);
    });

    it('manager sees masked; Admin+ sees full plaintext', async () => {
      await request(http).put(`${base}/${tech.id}/sensitive`).set(...hdr(tech))
        .send({ ssn: '123-45-6789' }).expect(200);

      const mgr = await request(http).get(`${base}/${tech.id}/sensitive`).set(...hdr(manager));
      expect(mgr.body.data.masked).toBe(true);

      const full = await request(http).get(`${base}/${tech.id}/sensitive`).set(...hdr(superAdmin));
      expect(full.body.data.masked).toBe(false);
      expect(full.body.data.ssn).toBe('123-45-6789');
    });

    it('forbids reading another technician’s sensitive data', async () => {
      const res = await request(http).get(`${base}/${tech2.id}/sensitive`).set(...hdr(tech));
      expect(res.status).toBe(403);
    });

    it('internal endpoint returns the decrypted bank account', async () => {
      await request(http).put(`${base}/${tech.id}/sensitive`).set(...hdr(tech))
        .send({ bankAccount: '000111222333' }).expect(200);

      const res = await request(http)
        .get(`${base}/internal/${tech.id}/bank-account`)
        .set('x-internal-secret', 'test-internal-secret');
      expect(res.status).toBe(200);
      expect(res.body.data.bankAccount).toBe('000111222333');
    });

    it('rejects the internal bank-account endpoint without the secret', async () => {
      const res = await request(http).get(`${base}/internal/${tech.id}/bank-account`);
      expect(res.status).toBe(403);
    });

    it('writes an audit record on every sensitive read', async () => {
      await request(http).put(`${base}/${tech.id}/sensitive`).set(...hdr(tech))
        .send({ ssn: '123-45-6789' }).expect(200);
      await request(http).get(`${base}/${tech.id}/sensitive`).set(...hdr(admin)).expect(200);

      const audit = await request(http).get(`${base}/${tech.id}/audit`).set(...hdr(admin));
      expect(audit.body.data.some((a: { action: string }) => a.action === 'sensitive.read')).toBe(true);
    });
  });
});
