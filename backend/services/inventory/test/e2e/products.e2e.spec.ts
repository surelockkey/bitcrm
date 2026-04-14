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

const readOnlyUser: JwtUser = {
  id: 'ro-1',
  cognitoSub: 'sub-ro',
  email: 'ro@test.com',
  roleId: 'role-read-only',
  department: 'HQ',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE = '/api/inventory/products';

function validProductPayload(overrides: Record<string, any> = {}) {
  return {
    name: 'Deadbolt Lock',
    sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: 'Locks',
    type: 'product',
    costCompany: 25,
    costTech: 30,
    priceClient: 50,
    serialTracking: false,
    minimumStockLevel: 10,
    ...overrides,
  };
}

async function createProduct(
  app: INestApplication,
  user: JwtUser,
  overrides: Record<string, any> = {},
) {
  const res = await request(app.getHttpServer())
    .post(BASE)
    .set('x-test-user', createTestUserHeader(user))
    .send(validProductPayload(overrides))
    .expect(201);
  return res.body.data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Products E2E', () => {
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

  it('POST /products - admin creates product successfully (201)', async () => {
    const payload = validProductPayload();
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.name).toBe(payload.name);
    expect(res.body.data.sku).toBe(payload.sku);
    expect(res.body.data.id).toBeDefined();
  });

  it('POST /products - technician gets 403', async () => {
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(techUser))
      .send(validProductPayload())
      .expect(403);
  });

  it('POST /products - validation error (missing name) gets 400', async () => {
    const { name, ...noName } = validProductPayload();
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(noName)
      .expect(400);
  });

  it('POST /products - duplicate SKU gets 409', async () => {
    const sku = `DUP-${Date.now()}`;
    await createProduct(app, adminUser, { sku });

    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(validProductPayload({ sku }))
      .expect(409);
  });

  // ---- LIST ----

  it('GET /products - lists products with pagination', async () => {
    await createProduct(app, adminUser, { name: 'Product A' });
    await createProduct(app, adminUser, { name: 'Product B' });

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination).toBeDefined();
  });

  it('GET /products?category=Locks - filters by category', async () => {
    await createProduct(app, adminUser, { category: 'Locks' });
    await createProduct(app, adminUser, { category: 'Cameras' });

    const res = await request(app.getHttpServer())
      .get(`${BASE}?category=Locks`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    for (const product of res.body.data) {
      expect(product.category).toBe('Locks');
    }
  });

  // ---- GET BY ID ----

  it('GET /products/:id - gets product by ID', async () => {
    const product = await createProduct(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${product.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(product.id);
  });

  it('GET /products/:id - nonexistent returns 404', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/nonexistent-id`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(404);
  });

  // ---- GET BY SKU ----

  it('GET /products/sku/:sku - gets by SKU', async () => {
    const sku = `SKU-BY-SKU-${Date.now()}`;
    const product = await createProduct(app, adminUser, { sku });

    const res = await request(app.getHttpServer())
      .get(`${BASE}/sku/${sku}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(product.id);
    expect(res.body.data.sku).toBe(sku);
  });

  // ---- UPDATE ----

  it('PUT /products/:id - updates product', async () => {
    const product = await createProduct(app, adminUser);

    const res = await request(app.getHttpServer())
      .put(`${BASE}/${product.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ name: 'Updated Name', costCompany: 99 })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Name');
    expect(res.body.data.costCompany).toBe(99);
  });

  // ---- DELETE / ARCHIVE ----

  it('DELETE /products/:id - archives product', async () => {
    const product = await createProduct(app, adminUser);

    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${product.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('archived');
  });

  // ---- AUTH ----

  it('GET /products - unauthenticated returns 401', async () => {
    await request(app.getHttpServer()).get(BASE).expect(401);
  });

  it('GET /products - read-only user can view products', async () => {
    await createProduct(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('x-test-user', createTestUserHeader(readOnlyUser))
      .expect(200);

    expect(res.body.success).toBe(true);
  });
});
