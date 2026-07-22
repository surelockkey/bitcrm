import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, cleanupData, createTestUserHeader } from './setup';

const BASE = '/api/deals/job-sources';

const admin: JwtUser = { id: 'admin-1', cognitoSub: 's1', email: 'a@t.com', roleId: 'role-admin', department: 'HQ' };
const readOnly: JwtUser = { id: 'ro-1', cognitoSub: 's2', email: 'ro@t.com', roleId: 'role-read-only', department: 'HQ' };
const hdr = (u: JwtUser) => ['x-test-user', createTestUserHeader(u)] as const;

describe('Job Sources E2E', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await setupApp(); });
  afterAll(async () => teardownApp());
  afterEach(async () => cleanupData());

  it('creates, lists and reads a job source as admin', async () => {
    const created = await request(app.getHttpServer())
      .post(BASE).set(...hdr(admin)).send({ name: 'Google Ads', priority: 3 })
      .expect(201);
    expect(created.body.data).toMatchObject({ name: 'Google Ads', priority: 3, active: true });
    const id = created.body.data.id;

    const list = await request(app.getHttpServer()).get(BASE).set(...hdr(admin)).expect(200);
    expect(list.body.data.some((t: { id: string }) => t.id === id)).toBe(true);

    const one = await request(app.getHttpServer()).get(`${BASE}/${id}`).set(...hdr(admin)).expect(200);
    expect(one.body.data.id).toBe(id);
  });

  it('rejects a duplicate name (409)', async () => {
    await request(app.getHttpServer()).post(BASE).set(...hdr(admin)).send({ name: 'Referral' }).expect(201);
    await request(app.getHttpServer()).post(BASE).set(...hdr(admin)).send({ name: '  referral ' }).expect(409);
  });

  it('updates a job source', async () => {
    const created = await request(app.getHttpServer()).post(BASE).set(...hdr(admin)).send({ name: 'Website' }).expect(201);
    const res = await request(app.getHttpServer())
      .put(`${BASE}/${created.body.data.id}`).set(...hdr(admin)).send({ priority: 9, active: false })
      .expect(200);
    expect(res.body.data).toMatchObject({ priority: 9, active: false });
  });

  it('hard-deletes an unreferenced job source', async () => {
    const created = await request(app.getHttpServer()).post(BASE).set(...hdr(admin)).send({ name: 'Temp Source' }).expect(201);
    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${created.body.data.id}`).set(...hdr(admin))
      .expect(200);
    expect(res.body.data).toMatchObject({ deleted: true, archived: false });
  });

  it('enforces permissions: read-only cannot create', async () => {
    await request(app.getHttpServer()).post(BASE).set(...hdr(readOnly)).send({ name: 'Nope' }).expect(403);
  });

  it('requires auth', async () => {
    await request(app.getHttpServer()).get(BASE).expect(401);
  });
});
