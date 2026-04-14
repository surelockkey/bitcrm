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

const techUser2: JwtUser = {
  id: 'tech-2',
  cognitoSub: 'sub-tech-2',
  email: 'tech2@test.com',
  roleId: 'role-technician',
  department: 'Atlanta',
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const BASE = '/api/inventory/containers';
const INTERNAL_SECRET = 'test-secret';

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

  // ---- GET MY CONTAINER ----

  it('GET /containers/my - technician gets their container (lazy created)', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.technicianId).toBe(techUser.id);
    expect(res.body.data.department).toBe(techUser.department);
  });

  it('GET /containers/my - calling twice returns same container', async () => {
    const res1 = await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    const res2 = await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    expect(res1.body.data.id).toBe(res2.body.data.id);
  });

  it('GET /containers/my - admin gets 404 (not a technician)', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(404);
  });

  // ---- LIST ----

  it('GET /containers - admin lists all containers', async () => {
    // Create containers for two technicians via the /my endpoint
    await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser2))
      .expect(200);

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
    const myRes = await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    const containerId = myRes.body.data.id;

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${containerId}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(containerId);
  });

  it('GET /containers/:id - nonexistent returns 404', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/nonexistent-id`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(404);
  });

  // ---- GET STOCK ----

  it('GET /containers/:id/stock - gets stock levels', async () => {
    const myRes = await request(app.getHttpServer())
      .get(`${BASE}/my`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    const containerId = myRes.body.data.id;

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${containerId}/stock`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // ---- INTERNAL ENSURE ----

  it('POST /containers/internal/ensure - creates container with internal secret header', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/internal/ensure`)
      .set('x-internal-secret', INTERNAL_SECRET)
      .send({
        technicianId: 'new-tech-42',
        technicianName: 'New Technician',
        department: 'Miami',
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.technicianId).toBe('new-tech-42');
    expect(res.body.data.department).toBe('Miami');
  });

  it('POST /containers/internal/ensure - rejected without secret (403)', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/internal/ensure`)
      .send({
        technicianId: 'new-tech-99',
        technicianName: 'Hacker',
        department: 'Evil',
      })
      .expect(403);
  });

  it('POST /containers/internal/ensure - idempotent (returns existing)', async () => {
    const payload = {
      technicianId: 'idempotent-tech',
      technicianName: 'Idemp Tech',
      department: 'Test',
    };

    const res1 = await request(app.getHttpServer())
      .post(`${BASE}/internal/ensure`)
      .set('x-internal-secret', INTERNAL_SECRET)
      .send(payload)
      .expect(201);

    const res2 = await request(app.getHttpServer())
      .post(`${BASE}/internal/ensure`)
      .set('x-internal-secret', INTERNAL_SECRET)
      .send(payload)
      .expect(201);

    expect(res1.body.data.id).toBe(res2.body.data.id);
  });
});
