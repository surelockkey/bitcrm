import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, cleanupData, createTestUserHeader } from './setup';

// ---------------------------------------------------------------------------
// Test users
// ---------------------------------------------------------------------------
const adminUser: JwtUser = {
  id: 'admin-1',
  cognitoSub: 'sub-admin',
  email: 'admin@test.com',
  roleId: 'role-admin',
  department: 'HQ',
};

const techUser: JwtUser = {
  id: 'tech-1',
  cognitoSub: 'sub-tech',
  email: 'tech@test.com',
  roleId: 'role-technician',
  department: 'Atlanta',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BASE = '/api/inventory/containers';

const createVan = (app: INestApplication, body: Record<string, unknown> = {}) =>
  request(app.getHttpServer())
    .post(BASE)
    .set('x-test-user', createTestUserHeader(adminUser))
    .send({ name: 'Van 1', description: 'North route', department: 'Atlanta', ...body });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Containers E2E', () => {
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

  // ---- CREATE ----

  it('POST /containers - admin creates a container manually', async () => {
    const res = await createVan(app).expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Van 1');
    expect(res.body.data.description).toBe('North route');
    expect(res.body.data.technicianId).toBeUndefined();
  });

  it('POST /containers - name is required', async () => {
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ description: 'no name' })
      .expect(400);
  });

  it('POST /containers - technician cannot create (403)', async () => {
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(techUser))
      .send({ name: 'Van X' })
      .expect(403);
  });

  // ---- UPDATE / ASSIGNMENT ----

  it('PUT /containers/:id - edits name and description', async () => {
    const created = await createVan(app).expect(201);

    const res = await request(app.getHttpServer())
      .put(`${BASE}/${created.body.data.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ name: 'Van 2', description: 'South route' })
      .expect(200);

    expect(res.body.data.name).toBe('Van 2');
    expect(res.body.data.description).toBe('South route');
  });

  it('PUT /containers/:id - assigns and unassigns a technician', async () => {
    const created = await createVan(app).expect(201);
    const id = created.body.data.id;

    const assigned = await request(app.getHttpServer())
      .put(`${BASE}/${id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ technicianId: techUser.id, technicianName: 'Tech One' })
      .expect(200);
    expect(assigned.body.data.technicianId).toBe(techUser.id);

    const unassigned = await request(app.getHttpServer())
      .put(`${BASE}/${id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ technicianId: null })
      .expect(200);
    expect(unassigned.body.data.technicianId).toBeUndefined();
    expect(unassigned.body.data.technicianName).toBeUndefined();
  });

  it('PUT /containers/:id - rejects assigning a technician who already has a container', async () => {
    const first = await createVan(app, { name: 'Van A' }).expect(201);
    const second = await createVan(app, { name: 'Van B' }).expect(201);

    await request(app.getHttpServer())
      .put(`${BASE}/${first.body.data.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ technicianId: techUser.id, technicianName: 'Tech One' })
      .expect(200);

    await request(app.getHttpServer())
      .put(`${BASE}/${second.body.data.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ technicianId: techUser.id, technicianName: 'Tech One' })
      .expect(400);
  });

  // ---- GET MY CONTAINER ----

  it('GET /containers/my - technician sees their assigned container', async () => {
    const created = await createVan(app).expect(201);

    await request(app.getHttpServer())
      .put(`${BASE}/${created.body.data.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ technicianId: techUser.id, technicianName: 'Tech One' })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    expect(res.body.data.id).toBe(created.body.data.id);
    expect(res.body.data.technicianId).toBe(techUser.id);
  });

  it('GET /containers/my - 404 when nothing is assigned (no lazy creation)', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(404);
  });

  // ---- LIST ----

  it('GET /containers - admin lists all containers', async () => {
    await createVan(app, { name: 'Van A' }).expect(201);
    await createVan(app, { name: 'Van B' }).expect(201);

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  // ---- GET BY ID ----

  it('GET /containers/:id - gets by ID', async () => {
    const created = await createVan(app).expect(201);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${created.body.data.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(created.body.data.id);
  });

  it('GET /containers/:id - nonexistent returns 404', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/nonexistent-id`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(404);
  });

  // ---- GET STOCK ----

  it('GET /containers/:id/stock - gets stock levels', async () => {
    const created = await createVan(app).expect(201);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${created.body.data.id}/stock`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
