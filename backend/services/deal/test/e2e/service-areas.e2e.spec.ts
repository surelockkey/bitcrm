import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ServiceAreaType, type JwtUser } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
} from './setup';

const admin: JwtUser = {
  id: 'admin-1', cognitoSub: 'c1', email: 'admin@test.com',
  roleId: 'role-admin', department: 'HQ',
};
const readOnly: JwtUser = {
  id: 'ro-1', cognitoSub: 'c2', email: 'ro@test.com',
  roleId: 'role-read-only', department: 'HQ',
};
const dispatcher: JwtUser = {
  id: 'disp-1', cognitoSub: 'c3', email: 'disp@test.com',
  roleId: 'role-dispatcher', department: 'HQ',
};

const box = (offset = 0) => ({
  name: `Area ${offset}`,
  type: ServiceAreaType.POLYGON,
  vertices: [
    { lat: 33.7 + offset, lng: -84.4 + offset },
    { lat: 33.7 + offset, lng: -84.3 + offset },
    { lat: 33.8 + offset, lng: -84.3 + offset },
    { lat: 33.8 + offset, lng: -84.4 + offset },
  ],
});

const BASE = '/api/deals/service-areas';

describe('Service Areas (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await setupApp();
  });

  afterAll(async () => {
    await teardownApp();
  });

  afterEach(async () => {
    await cleanupData();
  });

  const as = (user: JwtUser) => createTestUserHeader(user);

  it('creates a polygon service area and derives polygon coverage', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', as(admin))
      .send(box())
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.coverage).toEqual([
      { kind: 'polygon', vertices: box().vertices },
    ]);
  });

  it('lists and fetches created areas', async () => {
    const created = await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(admin)).send(box()).expect(201);
    const id = created.body.data.id;

    const list = await request(app.getHttpServer())
      .get(BASE).set('x-test-user', as(admin)).expect(200);
    expect(list.body.data).toHaveLength(1);

    const one = await request(app.getHttpServer())
      .get(`${BASE}/${id}`).set('x-test-user', as(admin)).expect(200);
    expect(one.body.data.id).toBe(id);
  });

  it('rejects an overlapping area with 409', async () => {
    await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(admin)).send(box()).expect(201);

    // A box shifted slightly still overlaps the first.
    await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(admin)).send(box(0.02)).expect(409);
  });

  it('allows a non-overlapping area', async () => {
    await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(admin)).send(box()).expect(201);
    await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(admin)).send(box(10)).expect(201);
  });

  it('resolves a location to its containing area, and null outside', async () => {
    const created = await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(admin)).send(box()).expect(201);
    const id = created.body.data.id;

    const inside = await request(app.getHttpServer())
      .post(`${BASE}/resolve`).set('x-test-user', as(admin))
      .send({ lat: 33.75, lng: -84.35 }).expect(201);
    expect(inside.body.data.id).toBe(id);

    const outside = await request(app.getHttpServer())
      .post(`${BASE}/resolve`).set('x-test-user', as(admin))
      .send({ lat: 10, lng: 10 }).expect(201);
    expect(outside.body.data).toBeNull();
  });

  it('previews coverage without persisting', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/preview`).set('x-test-user', as(admin))
      .send({ type: ServiceAreaType.POLYGON, vertices: box().vertices }).expect(201);
    expect(res.body.data).toEqual([{ kind: 'polygon', vertices: box().vertices }]);

    const list = await request(app.getHttpServer())
      .get(BASE).set('x-test-user', as(admin)).expect(200);
    expect(list.body.data).toHaveLength(0); // preview persisted nothing
  });

  it('updates name and deletes an area', async () => {
    const created = await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(admin)).send(box()).expect(201);
    const id = created.body.data.id;

    const updated = await request(app.getHttpServer())
      .put(`${BASE}/${id}`).set('x-test-user', as(admin))
      .send({ name: 'Renamed' }).expect(200);
    expect(updated.body.data.name).toBe('Renamed');

    await request(app.getHttpServer())
      .delete(`${BASE}/${id}`).set('x-test-user', as(admin)).expect(200);
    await request(app.getHttpServer())
      .get(`${BASE}/${id}`).set('x-test-user', as(admin)).expect(404);
  });

  it('enforces permissions', async () => {
    // read-only can view but not create
    await request(app.getHttpServer())
      .get(BASE).set('x-test-user', as(readOnly)).expect(200);
    await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(readOnly)).send(box()).expect(403);
    // dispatcher cannot create service areas either
    await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(dispatcher)).send(box()).expect(403);
    // unauthenticated
    await request(app.getHttpServer()).get(BASE).expect(401);
  });

  it('validates the polygon has at least 3 points', async () => {
    await request(app.getHttpServer())
      .post(BASE).set('x-test-user', as(admin))
      .send({ name: 'Bad', type: ServiceAreaType.POLYGON, vertices: [{ lat: 0, lng: 0 }] })
      .expect(400);
  });
});
