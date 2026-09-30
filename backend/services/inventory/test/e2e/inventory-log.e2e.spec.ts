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
const LOG_BASE = '/api/inventory/inventory-log';
const PRODUCTS_BASE = '/api/inventory/products';
const WAREHOUSES_BASE = '/api/inventory/warehouses';
const TRANSFERS_BASE = '/api/inventory/transfers';

async function createProduct(app: INestApplication, overrides: Record<string, any> = {}) {
  const res = await request(app.getHttpServer())
    .post(PRODUCTS_BASE)
    .set('x-test-user', createTestUserHeader(adminUser))
    .send({
      name: 'Kwikset Deadbolt',
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

async function createWarehouse(app: INestApplication) {
  const res = await request(app.getHttpServer())
    .post(WAREHOUSES_BASE)
    .set('x-test-user', createTestUserHeader(adminUser))
    .send({ name: `WH-${Date.now()}`, address: '123 St' })
    .expect(201);
  return res.body.data;
}

function listLog(app: INestApplication, user: JwtUser, query: Record<string, string> = {}) {
  return request(app.getHttpServer())
    .get(LOG_BASE)
    .query(query)
    .set('x-test-user', createTestUserHeader(user));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Inventory log E2E', () => {
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

  it('GET /inventory-log - no header gets 401', async () => {
    await request(app.getHttpServer()).get(LOG_BASE).expect(401);
    await request(app.getHttpServer()).get(`${LOG_BASE}/count`).expect(401);
  });

  it('GET /inventory-log - a role without reports.view gets 403', async () => {
    await listLog(app, readOnlyUser).expect(403);
    await request(app.getHttpServer())
      .get(`${LOG_BASE}/count`)
      .set('x-test-user', createTestUserHeader(readOnlyUser))
      .expect(403);
  });

  it('GET /inventory-log - admin reads an empty log', async () => {
    const res = await listLog(app, adminUser).expect(200);

    expect(res.body).toEqual({
      success: true,
      data: [],
      pagination: { nextCursor: undefined, count: 0 },
    });
  });

  // ---- THE JOURNAL ----

  it('records item edits and stock movements, newest first, with the catalog name', async () => {
    const product = await createProduct(app);
    const warehouse = await createWarehouse(app);
    await request(app.getHttpServer())
      .post(`${TRANSFERS_BASE}/receive`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        toType: 'warehouse',
        toId: warehouse.id,
        items: [{ productId: product.id, productName: 'anything', quantity: 5 }],
      })
      .expect(201);

    const res = await listLog(app, adminUser).expect(200);

    expect(res.body.data.map((e: any) => e.action)).toEqual(['stock_received', 'item_created']);
    expect(res.body.data[0]).toMatchObject({
      productId: product.id,
      productName: 'Kwikset Deadbolt',
      sku: product.sku,
      quantity: 5,
      toType: 'warehouse',
      toId: warehouse.id,
      toName: warehouse.name,
      userId: adminUser.id,
    });

    const count = await request(app.getHttpServer())
      .get(`${LOG_BASE}/count`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);
    expect(count.body.data).toEqual({ total: 2, atLeast: false });
  });

  it('filters by product, action and search, and a date-only `to` covers the whole day', async () => {
    const product = await createProduct(app, { name: 'Schlage Knob' });
    const other = await createProduct(app, { name: 'Padlock' });
    const today = new Date().toISOString().slice(0, 10);

    const byProduct = await listLog(app, adminUser, { productId: product.id }).expect(200);
    expect(byProduct.body.data.map((e: any) => e.productId)).toEqual([product.id]);

    const byAction = await listLog(app, adminUser, { action: 'item_created' }).expect(200);
    expect(byAction.body.data).toHaveLength(2);

    const bySearch = await listLog(app, adminUser, { search: 'PADLOCK' }).expect(200);
    expect(bySearch.body.data.map((e: any) => e.productId)).toEqual([other.id]);

    const byDay = await listLog(app, adminUser, { from: today, to: today }).expect(200);
    expect(byDay.body.data).toHaveLength(2);
  });

  it('rejects a window wider than 24 months and a malformed cursor with 400', async () => {
    await listLog(app, adminUser, { from: '1970-01-01' }).expect(400);
    await listLog(app, adminUser, { cursor: 'garbage' }).expect(400);
  });

  it('pages with a cursor that carries its window', async () => {
    await createProduct(app);
    await createProduct(app);
    await createProduct(app);

    const first = await listLog(app, adminUser, { limit: '2' }).expect(200);
    expect(first.body.data).toHaveLength(2);
    expect(first.body.pagination.nextCursor).toBeDefined();

    const second = await listLog(app, adminUser, { limit: '2', cursor: first.body.pagination.nextCursor }).expect(200);
    expect(second.body.data).toHaveLength(1);
    expect(second.body.pagination.nextCursor).toBeUndefined();
  });
});
