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

const noAccessUser: JwtUser = {
  id: 'none-1',
  cognitoSub: 'sub-none',
  email: 'none@test.com',
  roleId: 'role-no-access',
  department: 'HQ',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const STOCK_BASE = '/api/inventory/stock';
const PRODUCTS_BASE = '/api/inventory/products';
const WAREHOUSES_BASE = '/api/inventory/warehouses';
const CONTAINERS_BASE = '/api/inventory/containers';
const TRANSFERS_BASE = '/api/inventory/transfers';

async function createProduct(app: INestApplication, overrides: Record<string, any> = {}) {
  const res = await request(app.getHttpServer())
    .post(PRODUCTS_BASE)
    .set('x-test-user', createTestUserHeader(adminUser))
    .send({
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
    })
    .expect(201);
  return res.body.data;
}

async function createWarehouse(app: INestApplication, name: string) {
  const res = await request(app.getHttpServer())
    .post(WAREHOUSES_BASE)
    .set('x-test-user', createTestUserHeader(adminUser))
    .send({ name, address: '123 St' })
    .expect(201);
  return res.body.data;
}

async function createContainer(
  app: INestApplication,
  name: string,
  technicianId: string,
  department: string,
) {
  const res = await request(app.getHttpServer())
    .post(CONTAINERS_BASE)
    .set('x-test-user', createTestUserHeader(adminUser))
    .send({ name, department, technicianId, technicianName: name })
    .expect(201);
  return res.body.data;
}

function receive(app: INestApplication, toType: string, toId: string, productId: string, quantity: number) {
  return request(app.getHttpServer())
    .post(`${TRANSFERS_BASE}/receive`)
    .set('x-test-user', createTestUserHeader(adminUser))
    .send({ toType, toId, items: [{ productId, productName: 'Deadbolt Lock', quantity }] })
    .expect(201);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Stock E2E', () => {
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

  // ---- AUTHORIZATION ----

  it('GET /stock/products/:id - no header gets 401', async () => {
    await request(app.getHttpServer()).get(`${STOCK_BASE}/products/p1`).expect(401);
  });

  it('GET /stock/products/:id - a role without products.view gets 403', async () => {
    await request(app.getHttpServer())
      .get(`${STOCK_BASE}/products/p1`)
      .set('x-test-user', createTestUserHeader(noAccessUser))
      .expect(403);
  });

  it('GET /stock/products/:id - unknown product is 404', async () => {
    await request(app.getHttpServer())
      .get(`${STOCK_BASE}/products/nope`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(404);
  });

  // ---- THE POPUP ----

  it('GET /stock/products/:id - admin sees every warehouse and container with its quantity', async () => {
    const product = await createProduct(app);
    const warehouse = await createWarehouse(app, '(1) STORE');
    const mine = await createContainer(app, '(2) MINE', techUser.id, 'Atlanta');
    const other = await createContainer(app, '(3) OTHER', 'tech-2', 'Atlanta');
    await receive(app, 'warehouse', warehouse.id, product.id, 10);
    await receive(app, 'container', other.id, product.id, 3);

    const res = await request(app.getHttpServer())
      .get(`${STOCK_BASE}/products/${product.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.productId).toBe(product.id);
    expect(res.body.data.onHand).toBe(13);
    expect(res.body.data.locations.map((l: any) => [l.locationId, l.quantity])).toEqual([
      [warehouse.id, 10],
      [mine.id, 0],
      [other.id, 3],
    ]);
  });

  // The same scope as GET /containers and GET /warehouses for that user.
  it('GET /stock/products/:id - a technician sees only their own van, and no warehouse', async () => {
    const product = await createProduct(app);
    const warehouse = await createWarehouse(app, '(1) STORE');
    const mine = await createContainer(app, '(2) MINE', techUser.id, 'Atlanta');
    const other = await createContainer(app, '(3) OTHER', 'tech-2', 'Atlanta');
    await receive(app, 'warehouse', warehouse.id, product.id, 10);
    await receive(app, 'container', other.id, product.id, 3);
    await receive(app, 'container', mine.id, product.id, 2);

    const res = await request(app.getHttpServer())
      .get(`${STOCK_BASE}/products/${product.id}`)
      .set('x-test-user', createTestUserHeader(techUser))
      .expect(200);

    expect(res.body.data.onHand).toBe(2);
    expect(res.body.data.locations.map((l: any) => [l.locationId, l.quantity])).toEqual([[mine.id, 2]]);
  });

  // ---- onHand ON THE PRODUCT ROW ----

  it('keeps Product.onHand in step with the moves, and a transfer leaves it alone', async () => {
    const product = await createProduct(app);
    const warehouse = await createWarehouse(app, '(1) STORE');
    const van = await createContainer(app, '(2) MINE', techUser.id, 'Atlanta');
    await receive(app, 'warehouse', warehouse.id, product.id, 10);

    await request(app.getHttpServer())
      .post(TRANSFERS_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'warehouse',
        fromId: warehouse.id,
        toType: 'container',
        toId: van.id,
        items: [{ productId: product.id, productName: product.name, quantity: 4 }],
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`${TRANSFERS_BASE}/return`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        fromType: 'container',
        fromId: van.id,
        items: [{ productId: product.id, productName: product.name, quantity: 1 }],
        reason: 'damaged',
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`${PRODUCTS_BASE}/${product.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.data.onHand).toBe(9);
  });
});
