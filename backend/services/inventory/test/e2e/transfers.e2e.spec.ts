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
// Constants
// ---------------------------------------------------------------------------
const TRANSFERS_BASE = '/api/inventory/transfers';
const PRODUCTS_BASE = '/api/inventory/products';
const WAREHOUSES_BASE = '/api/inventory/warehouses';
const CONTAINERS_BASE = '/api/inventory/containers';
const INTERNAL_SECRET = 'test-secret';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function validProductPayload(overrides: Record<string, any> = {}) {
  return {
    name: 'Test Product',
    sku: `SKU-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category: 'Parts',
    type: 'product',
    costCompany: 10,
    costTech: 15,
    priceClient: 25,
    serialTracking: false,
    minimumStockLevel: 5,
    ...overrides,
  };
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

async function createWarehouse(
  app: INestApplication,
  user: JwtUser,
  overrides: Record<string, any> = {},
) {
  const res = await request(app.getHttpServer())
    .post(WAREHOUSES_BASE)
    .set('x-test-user', createTestUserHeader(user))
    .send({
      name: `WH-${Date.now()}`,
      address: '123 St',
      ...overrides,
    })
    .expect(201);
  return res.body.data;
}

async function receiveStock(
  app: INestApplication,
  user: JwtUser,
  warehouseId: string,
  items: Array<{ productId: string; productName: string; quantity: number }>,
) {
  await request(app.getHttpServer())
    .post(`${WAREHOUSES_BASE}/${warehouseId}/receive`)
    .set('x-test-user', createTestUserHeader(user))
    .send({ items })
    .expect(201);
}

async function ensureContainer(
  app: INestApplication,
  technicianId: string,
  technicianName: string,
  department: string,
) {
  const res = await request(app.getHttpServer())
    .post(`${CONTAINERS_BASE}/internal/ensure`)
    .set('x-internal-secret', INTERNAL_SECRET)
    .send({ technicianId, technicianName, department })
    .expect(201);
  return res.body.data;
}

function getStockLevels(
  app: INestApplication,
  user: JwtUser,
  entityBase: string,
  entityId: string,
) {
  return request(app.getHttpServer())
    .get(`${entityBase}/${entityId}/stock`)
    .set('x-test-user', createTestUserHeader(user))
    .expect(200);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Transfers E2E', () => {
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

  // ---- FULL FLOW ----

  it('Full flow: warehouse -> receive stock -> transfer to container -> verify stock', async () => {
    const product = await createProduct(app, adminUser);
    const warehouse = await createWarehouse(app, adminUser);
    const container = await ensureContainer(app, 'tech-flow', 'Flow Tech', 'HQ');

    // Receive stock into warehouse
    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 20 },
    ]);

    // Transfer warehouse -> container
    const transferRes = await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 8 },
        ],
        notes: 'Replenish tech container',
      })
      .expect(201);

    expect(transferRes.body.success).toBe(true);
    expect(transferRes.body.data.id).toBeDefined();

    // Verify warehouse stock decreased
    const whStock = await getStockLevels(app, adminUser, WAREHOUSES_BASE, warehouse.id);
    const whItem = whStock.body.data.find((s: any) => s.productId === product.id);
    expect(whItem.quantity).toBe(12);

    // Verify container stock increased
    const cStock = await getStockLevels(app, adminUser, CONTAINERS_BASE, container.id);
    const cItem = cStock.body.data.find((s: any) => s.productId === product.id);
    expect(cItem.quantity).toBe(8);
  });

  // ---- CREATE TRANSFER ----

  it('POST /transfers - warehouse to container transfer', async () => {
    const product = await createProduct(app, adminUser);
    const warehouse = await createWarehouse(app, adminUser);
    const container = await ensureContainer(app, 'tech-wc', 'WC Tech', 'HQ');

    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 15 },
    ]);

    const res = await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 5 },
        ],
      })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.fromType).toBe('warehouse');
    expect(res.body.data.toType).toBe('container');
  });

  it('POST /transfers - container to container transfer', async () => {
    const product = await createProduct(app, adminUser);
    const warehouse = await createWarehouse(app, adminUser);
    const containerA = await ensureContainer(app, 'tech-cc-a', 'Tech A', 'HQ');
    const containerB = await ensureContainer(app, 'tech-cc-b', 'Tech B', 'HQ');

    // Seed stock: warehouse -> containerA
    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 10 },
    ]);
    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: containerA.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 10 },
        ],
      })
      .expect(201);

    // container -> container
    const res = await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'container',
        fromId: containerA.id,
        toType: 'container',
        toId: containerB.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 3 },
        ],
      })
      .expect(201);

    expect(res.body.success).toBe(true);

    // Verify stock levels
    const stockA = await getStockLevels(app, adminUser, CONTAINERS_BASE, containerA.id);
    const itemA = stockA.body.data.find((s: any) => s.productId === product.id);
    expect(itemA.quantity).toBe(7);

    const stockB = await getStockLevels(app, adminUser, CONTAINERS_BASE, containerB.id);
    const itemB = stockB.body.data.find((s: any) => s.productId === product.id);
    expect(itemB.quantity).toBe(3);
  });

  it('POST /transfers - invalid route (supplier to container) returns 400', async () => {
    const product = await createProduct(app, adminUser);
    const container = await ensureContainer(app, 'tech-inv', 'Inv Tech', 'HQ');

    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'supplier',
        fromId: 'some-supplier',
        toType: 'container',
        toId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 1 },
        ],
      })
      .expect(400);
  });

  it('POST /transfers - insufficient stock returns 400', async () => {
    const product = await createProduct(app, adminUser);
    const warehouse = await createWarehouse(app, adminUser);
    const container = await ensureContainer(app, 'tech-insuf', 'Insuf Tech', 'HQ');

    // Receive only 5 units
    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 5 },
    ]);

    // Try to transfer 50
    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 50 },
        ],
      })
      .expect(400);
  });

  // ---- LIST ----

  it('GET /transfers - lists all transfers', async () => {
    const product = await createProduct(app, adminUser);
    const warehouse = await createWarehouse(app, adminUser);
    const container = await ensureContainer(app, 'tech-list', 'List Tech', 'HQ');

    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 20 },
    ]);

    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 2 },
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  // ---- GET BY ID ----

  it('GET /transfers/:id - gets by ID', async () => {
    const product = await createProduct(app, adminUser);
    const warehouse = await createWarehouse(app, adminUser);
    const container = await ensureContainer(app, 'tech-byid', 'ById Tech', 'HQ');

    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 10 },
    ]);

    const createRes = await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 1 },
        ],
      })
      .expect(201);

    const transferId = createRes.body.data.id;

    const res = await request(app.getHttpServer())
      .get(`${TRANSFERS_BASE}/${transferId}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(transferId);
  });

  // ---- GET BY ENTITY ----

  it('GET /transfers/entity/:type/:id - lists by entity', async () => {
    const product = await createProduct(app, adminUser);
    const warehouse = await createWarehouse(app, adminUser);
    const container = await ensureContainer(app, 'tech-entity', 'Entity Tech', 'HQ');

    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 20 },
    ]);

    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 3 },
        ],
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`${TRANSFERS_BASE}/entity/warehouse/${warehouse.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  // ---- INTERNAL DEDUCT ----

  it('POST /transfers/internal/stock/deduct - internal deduct with secret', async () => {
    const product = await createProduct(app, adminUser);
    const warehouse = await createWarehouse(app, adminUser);
    const container = await ensureContainer(app, 'tech-deduct', 'Deduct Tech', 'HQ');

    // Seed stock into container via warehouse
    await receiveStock(app, adminUser, warehouse.id, [
      { productId: product.id, productName: product.name, quantity: 10 },
    ]);
    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 10 },
        ],
      })
      .expect(201);

    // Deduct via internal endpoint
    const res = await request(app.getHttpServer())
      .post(`${TRANSFERS_BASE}/internal/stock/deduct`)
      .set('x-internal-secret', INTERNAL_SECRET)
      .send({
        containerId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 4 },
        ],
        dealId: 'deal-123',
        performedBy: 'tech-deduct',
        performedByName: 'Deduct Tech',
      })
      .expect(201);

    expect(res.body.success).toBe(true);

    // Verify stock decreased
    const stockRes = await getStockLevels(app, adminUser, CONTAINERS_BASE, container.id);
    const stockItem = stockRes.body.data.find(
      (s: any) => s.productId === product.id,
    );
    expect(stockItem.quantity).toBe(6);
  });

  // ---- INTERNAL RESTORE ----

  it('POST /transfers/internal/stock/restore - internal restore with secret', async () => {
    const product = await createProduct(app, adminUser);
    const container = await ensureContainer(app, 'tech-restore', 'Restore Tech', 'HQ');

    // Restore stock to container
    const res = await request(app.getHttpServer())
      .post(`${TRANSFERS_BASE}/internal/stock/restore`)
      .set('x-internal-secret', INTERNAL_SECRET)
      .send({
        containerId: container.id,
        items: [
          { productId: product.id, productName: product.name, quantity: 7 },
        ],
        dealId: 'deal-456',
        performedBy: 'tech-restore',
        performedByName: 'Restore Tech',
      })
      .expect(201);

    expect(res.body.success).toBe(true);

    // Verify stock
    const stockRes = await getStockLevels(app, adminUser, CONTAINERS_BASE, container.id);
    const stockItem = stockRes.body.data.find(
      (s: any) => s.productId === product.id,
    );
    expect(stockItem.quantity).toBe(7);
  });

  // ---- INTERNAL without secret ----

  it('POST /transfers/internal/stock/deduct - rejected without secret', async () => {
    await request(app.getHttpServer())
      .post(`${TRANSFERS_BASE}/internal/stock/deduct`)
      .send({
        containerId: 'c1',
        items: [{ productId: 'p1', productName: 'P', quantity: 1 }],
        dealId: 'd1',
        performedBy: 'u1',
        performedByName: 'U',
      })
      .expect(403);
  });

  it('POST /transfers/internal/stock/restore - rejected without secret', async () => {
    await request(app.getHttpServer())
      .post(`${TRANSFERS_BASE}/internal/stock/restore`)
      .send({
        containerId: 'c1',
        items: [{ productId: 'p1', productName: 'P', quantity: 1 }],
        dealId: 'd1',
        performedBy: 'u1',
        performedByName: 'U',
      })
      .expect(403);
  });

  // ---- PERMISSION CHECKS ----

  it('POST /transfers - technician gets 403 on create transfer', async () => {
    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(techUser))
      .send({
        fromType: 'warehouse',
        fromId: 'wh1',
        toType: 'container',
        toId: 'c1',
        items: [{ productId: 'p1', productName: 'P', quantity: 1 }],
      })
      .expect(403);
  });

  it('POST /transfers - dispatcher gets 403 on create transfer', async () => {
    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(dispatcherUser))
      .send({
        fromType: 'warehouse',
        fromId: 'wh1',
        toType: 'container',
        toId: 'c1',
        items: [{ productId: 'p1', productName: 'P', quantity: 1 }],
      })
      .expect(403);
  });

  it('GET /transfers - technician can view transfers', async () => {
    const res = await request(app.getHttpServer())
      .get(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    expect(res.body.success).toBe(true);
  });
});
