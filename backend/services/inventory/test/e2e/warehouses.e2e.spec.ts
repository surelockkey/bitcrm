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

const dispatcherUser: JwtUser = {
  id: 'disp-1',
  cognitoSub: 'sub-disp',
  email: 'disp@test.com',
  roleId: 'role-dispatcher',
  department: 'Atlanta',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE = '/api/inventory/warehouses';
const PRODUCTS_BASE = '/api/inventory/products';

function validWarehousePayload(overrides: Record<string, any> = {}) {
  return {
    name: `Warehouse ${Date.now()}`,
    address: '123 Test St',
    description: 'Test warehouse',
    ...overrides,
  };
}

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

async function createWarehouse(
  app: INestApplication,
  user: JwtUser,
  overrides: Record<string, any> = {},
) {
  const res = await request(app.getHttpServer())
    .post(BASE)
    .set('x-test-user', createTestUserHeader(user))
    .send(validWarehousePayload(overrides))
    .expect(201);
  return res.body.data;
}

async function createProduct(
  app: INestApplication,
  user: JwtUser,
  overrides: Record<string, any> = {},
) {
  const res = await request(app.getHttpServer())
    .post(PRODUCTS_BASE)
    .set('x-test-user', createTestUserHeader(user))
    .send(validProductPayload(overrides))
    .expect(201);
  return res.body.data;
}

async function receiveStock(
  app: INestApplication,
  user: JwtUser,
  warehouseId: string,
  items: Array<{ productId: string; productName: string; quantity: number }>,
) {
  const res = await request(app.getHttpServer())
    .post(`${BASE}/${warehouseId}/receive`)
    .set('x-test-user', createTestUserHeader(user))
    .send({ items })
    .expect(201);
  return res.body;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Warehouses E2E', () => {
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

  it('POST /warehouses - admin creates warehouse', async () => {
    const payload = validWarehousePayload();
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe(payload.name);
    expect(res.body.data.id).toBeDefined();
  });

  it('POST /warehouses - technician gets 403', async () => {
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(techUser))
      .send(validWarehousePayload())
      .expect(403);
  });

  it('POST /warehouses - dispatcher gets 403 on create', async () => {
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(dispatcherUser))
      .send(validWarehousePayload())
      .expect(403);
  });

  // ---- LIST ----

  it('GET /warehouses - lists warehouses', async () => {
    await createWarehouse(app, adminUser, { name: 'WH-A' });
    await createWarehouse(app, adminUser, { name: 'WH-B' });

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it('GET /warehouses - dispatcher can view warehouses', async () => {
    await createWarehouse(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('x-test-user', createTestUserHeader(dispatcherUser))
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  // ---- GET BY ID ----

  it('GET /warehouses/:id - gets by ID', async () => {
    const warehouse = await createWarehouse(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${warehouse.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(warehouse.id);
  });

  // ---- UPDATE ----

  it('PUT /warehouses/:id - updates warehouse', async () => {
    const warehouse = await createWarehouse(app, adminUser);

    const res = await request(app.getHttpServer())
      .put(`${BASE}/${warehouse.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ name: 'Updated Warehouse' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe('Updated Warehouse');
  });

  it('PUT /warehouses/:id - technician gets 403 on edit', async () => {
    const warehouse = await createWarehouse(app, adminUser);

    await request(app.getHttpServer())
      .put(`${BASE}/${warehouse.id}`)
      .set('x-test-user', createTestUserHeader(techUser))
      .send({ name: 'Hacked' })
      .expect(403);
  });

  // ---- DELETE / ARCHIVE ----

  it('DELETE /warehouses/:id - admin cannot delete (no permission)', async () => {
    const warehouse = await createWarehouse(app, adminUser);

    await request(app.getHttpServer())
      .delete(`${BASE}/${warehouse.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(403);
  });

  it('DELETE /warehouses/:id - super admin archives warehouse', async () => {
    const superAdmin: JwtUser = {
      id: 'sa-1', cognitoSub: 'sub-sa', email: 'sa@test.com',
      roleId: 'role-super-admin', department: 'HQ',
    };
    const warehouse = await createWarehouse(app, adminUser);

    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${warehouse.id}`)
      .set('x-test-user', createTestUserHeader(superAdmin))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('archived');
  });

  it('DELETE /warehouses/:id - technician gets 403 on delete', async () => {
    const warehouse = await createWarehouse(app, adminUser);

    await request(app.getHttpServer())
      .delete(`${BASE}/${warehouse.id}`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(403);
  });

  // ---- RECEIVE STOCK ----

  it('POST /warehouses/:id/receive - receives stock, verify stock levels increase', async () => {
    const warehouse = await createWarehouse(app, adminUser);
    const product = await createProduct(app, adminUser);

    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 10 },
    ]);

    const stockRes = await request(app.getHttpServer())
      .get(`${BASE}/${warehouse.id}/stock`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(stockRes.body.success).toBe(true);
    expect(Array.isArray(stockRes.body.data)).toBe(true);

    const stockItem = stockRes.body.data.find(
      (s: any) => s.productId === product.id,
    );
    expect(stockItem).toBeDefined();
    expect(stockItem.quantity).toBe(10);
  });

  it('POST /warehouses/:id/receive - receiving more stock accumulates', async () => {
    const warehouse = await createWarehouse(app, adminUser);
    const product = await createProduct(app, adminUser);

    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 5 },
    ]);
    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 3 },
    ]);

    const stockRes = await request(app.getHttpServer())
      .get(`${BASE}/${warehouse.id}/stock`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    const stockItem = stockRes.body.data.find(
      (s: any) => s.productId === product.id,
    );
    expect(stockItem.quantity).toBe(8);
  });

  // ---- GET STOCK ----

  it('GET /warehouses/:id/stock - returns stock levels', async () => {
    const warehouse = await createWarehouse(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${warehouse.id}/stock`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
