import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
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

// The default admin role may not delete containers; archiving a template asks containers.delete.
const superAdminUser: JwtUser = {
  id: 'super-1',
  cognitoSub: 'sub-super',
  email: 'super@test.com',
  roleId: 'role-super-admin',
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
  id: 'na-1',
  cognitoSub: 'sub-na',
  email: 'na@test.com',
  roleId: 'role-no-access',
  department: 'HQ',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE = '/api/inventory/container-templates';
const PRODUCTS = '/api/inventory/products';
const WAREHOUSES = '/api/inventory/warehouses';
const CONTAINERS = '/api/inventory/containers';
const TRANSFERS = '/api/inventory/transfers';

const as = (user: JwtUser) => createTestUserHeader(user);

describe('Container templates E2E', () => {
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

  const createProduct = async (name: string, overrides: Record<string, unknown> = {}) =>
    (
      await request(app.getHttpServer())
        .post(PRODUCTS)
        .set('x-test-user', as(adminUser))
        .send({
          name,
          sku: `SKU-${name}-${Math.random().toString(36).slice(2, 8)}`,
          category: 'Locks',
          type: 'product',
          costCompany: 10,
          costTech: 15,
          priceClient: 25,
          serialTracking: false,
          minimumStockLevel: 0,
          ...overrides,
        })
        .expect(201)
    ).body.data;

  const createWarehouse = async () =>
    (
      await request(app.getHttpServer())
        .post(WAREHOUSES)
        .set('x-test-user', as(adminUser))
        .send({ name: '(1) STORE', address: '1 Main St' })
        .expect(201)
    ).body.data;

  const createVan = async () =>
    (
      await request(app.getHttpServer())
        .post(CONTAINERS)
        .set('x-test-user', as(adminUser))
        .send({ name: '(12) MIKE', department: 'Atlanta' })
        .expect(201)
    ).body.data;

  const createTemplate = (body: Record<string, unknown>, user: JwtUser = adminUser) =>
    request(app.getHttpServer()).post(BASE).set('x-test-user', as(user)).send(body);

  it('creates a template, compares a van with it and fills the van from the store in one transfer', async () => {
    const deadbolt = await createProduct('Deadbolt');
    const kit = await createProduct('Rekey kit');
    const store = await createWarehouse();
    const van = await createVan();

    await request(app.getHttpServer())
      .post(`${WAREHOUSES}/${store.id}/receive`)
      .set('x-test-user', as(adminUser))
      .send({
        items: [
          { productId: deadbolt.id, productName: 'x', quantity: 3 },
          { productId: kit.id, productName: 'x', quantity: 10 },
        ],
      })
      .expect(201);

    const created = await createTemplate({
      name: 'Standard van',
      items: [
        { productId: deadbolt.id, quantity: 5 },
        { productId: kit.id, quantity: 2 },
      ],
    }).expect(201);
    const template = created.body.data;
    expect(template.items).toEqual([
      { productId: deadbolt.id, productName: 'Deadbolt', sku: deadbolt.sku, quantity: 5 },
      { productId: kit.id, productName: 'Rekey kit', sku: kit.sku, quantity: 2 },
    ]);

    const diff = await request(app.getHttpServer())
      .get(`${BASE}/${template.id}/diff?containerId=${van.id}&warehouseId=${store.id}`)
      .set('x-test-user', as(adminUser))
      .expect(200);
    expect(diff.body.data).toMatchObject({
      templateId: template.id,
      containerId: van.id,
      containerName: '(12) MIKE',
      warehouseId: store.id,
      shortLineCount: 2,
      missingUnits: 7,
    });
    expect(
      diff.body.data.lines.map((l: Record<string, number>) => [l.target, l.onHand, l.missing, l.available, l.willMove]),
    ).toEqual([
      [5, 0, 5, 3, 3],
      [2, 0, 2, 10, 2],
    ]);

    const requestId = randomUUID();
    const fill = await request(app.getHttpServer())
      .post(`${BASE}/${template.id}/fill`)
      .set('x-test-user', as(adminUser))
      .send({ containerId: van.id, warehouseId: store.id, requestId })
      .expect(201);
    expect(fill.body.data.transfer.notes).toBe('Template: Standard van');
    expect(fill.body.data.moved).toHaveLength(2);
    expect(fill.body.data.short.map((l: { productId: string }) => l.productId)).toEqual([deadbolt.id]);

    const stock = await request(app.getHttpServer())
      .get(`${CONTAINERS}/${van.id}/stock`)
      .set('x-test-user', as(adminUser))
      .expect(200);
    const held = Object.fromEntries(
      stock.body.data.map((s: { productId: string; quantity: number }) => [s.productId, s.quantity]),
    );
    expect(held).toEqual({ [deadbolt.id]: 3, [kit.id]: 2 });

    // A double submit (same requestId): the first answer again, 200, nothing moved.
    const replay = await request(app.getHttpServer())
      .post(`${BASE}/${template.id}/fill`)
      .set('x-test-user', as(adminUser))
      .send({ containerId: van.id, warehouseId: store.id, requestId })
      .expect(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.transfer.id).toBe(fill.body.data.transfer.id);

    // A new request with nothing left to move: no transfer, not an error.
    const again = await request(app.getHttpServer())
      .post(`${BASE}/${template.id}/fill`)
      .set('x-test-user', as(adminUser))
      .send({ containerId: van.id, warehouseId: store.id, requestId: randomUUID() })
      .expect(201);
    expect(again.body.data.transfer).toBeUndefined();
    expect(again.body.data.moved).toEqual([]);

    const transfers = await request(app.getHttpServer())
      .get(TRANSFERS)
      .set('x-test-user', as(adminUser))
      .expect(200);
    expect(transfers.body.data.filter((t: { type: string }) => t.type === 'transfer')).toHaveLength(1);
  });

  it('validates lines and names', async () => {
    const product = await createProduct('Deadbolt');
    const service = await createProduct('Rekey', { type: 'service' });
    const untracked = await createProduct('Screws', { manageStock: false });

    await createTemplate({ name: 'Van', items: [] }).expect(400);
    await createTemplate({ name: 'Van', items: [{ productId: product.id, quantity: 0 }] }).expect(400);
    await createTemplate({
      name: 'Van',
      items: [
        { productId: product.id, quantity: 1 },
        { productId: product.id, quantity: 2 },
      ],
    }).expect(400);
    await createTemplate({ name: 'Van', items: [{ productId: 'ghost', quantity: 1 }] }).expect(400);
    await createTemplate({ name: 'Van', items: [{ productId: service.id, quantity: 1 }] }).expect(400);
    await createTemplate({ name: 'Van', items: [{ productId: untracked.id, quantity: 1 }] }).expect(400);

    await createTemplate({ name: 'Van', items: [{ productId: product.id, quantity: 1 }] }).expect(201);
    await createTemplate({ name: ' VAN ', items: [{ productId: product.id, quantity: 1 }] }).expect(409);
  });

  it('archives instead of deleting, and lists active ones by default', async () => {
    const product = await createProduct('Deadbolt');
    const created = await createTemplate({ name: 'Old van', items: [{ productId: product.id, quantity: 1 }] }).expect(201);

    await request(app.getHttpServer())
      .delete(`${BASE}/${created.body.data.id}`)
      .set('x-test-user', as(adminUser))
      .expect(403);
    const archived = await request(app.getHttpServer())
      .delete(`${BASE}/${created.body.data.id}`)
      .set('x-test-user', as(superAdminUser))
      .expect(200);
    expect(archived.body.data.status).toBe('archived');

    const active = await request(app.getHttpServer()).get(BASE).set('x-test-user', as(adminUser)).expect(200);
    expect(active.body.data).toEqual([]);
    const listed = await request(app.getHttpServer())
      .get(`${BASE}?status=archived`)
      .set('x-test-user', as(adminUser))
      .expect(200);
    expect(listed.body.data.map((t: { id: string }) => t.id)).toEqual([created.body.data.id]);

    // An archived template cannot be given to a van.
    const van = await createVan();
    await request(app.getHttpServer())
      .put(`${CONTAINERS}/${van.id}`)
      .set('x-test-user', as(adminUser))
      .send({ templateId: created.body.data.id })
      .expect(400);
  });

  it('points a van at a template and clears it with null', async () => {
    const product = await createProduct('Deadbolt');
    const template = (await createTemplate({ name: 'Van', items: [{ productId: product.id, quantity: 1 }] }).expect(201))
      .body.data;
    const van = await createVan();

    const set = await request(app.getHttpServer())
      .put(`${CONTAINERS}/${van.id}`)
      .set('x-test-user', as(adminUser))
      .send({ templateId: template.id })
      .expect(200);
    expect(set.body.data.templateId).toBe(template.id);

    const cleared = await request(app.getHttpServer())
      .put(`${CONTAINERS}/${van.id}`)
      .set('x-test-user', as(adminUser))
      .send({ templateId: null })
      .expect(200);
    expect(cleared.body.data.templateId).toBeUndefined();

    await request(app.getHttpServer())
      .put(`${CONTAINERS}/${van.id}`)
      .set('x-test-user', as(adminUser))
      .send({ templateId: 'missing' })
      .expect(404);
  });

  it('404s the diff on an unknown container or warehouse', async () => {
    const product = await createProduct('Deadbolt');
    const template = (await createTemplate({ name: 'Van', items: [{ productId: product.id, quantity: 1 }] }).expect(201))
      .body.data;
    const van = await createVan();

    await request(app.getHttpServer())
      .get(`${BASE}/${template.id}/diff?containerId=missing`)
      .set('x-test-user', as(adminUser))
      .expect(404);
    await request(app.getHttpServer())
      .get(`${BASE}/${template.id}/diff?containerId=${van.id}&warehouseId=missing`)
      .set('x-test-user', as(adminUser))
      .expect(404);
    await request(app.getHttpServer())
      .get(`${BASE}/${template.id}/diff`)
      .set('x-test-user', as(adminUser))
      .expect(400);
  });

  describe('authorization', () => {
    it('401s without a user', async () => {
      await request(app.getHttpServer()).get(BASE).expect(401);
      await request(app.getHttpServer()).post(`${BASE}/any/fill`).send({}).expect(401);
    });

    it('lets a technician read but not create or fill (403)', async () => {
      await request(app.getHttpServer()).get(BASE).set('x-test-user', as(techUser)).expect(200);
      await createTemplate({ name: 'Van', items: [{ productId: 'p', quantity: 1 }] }, techUser).expect(403);
      await request(app.getHttpServer())
        .post(`${BASE}/any/fill`)
        .set('x-test-user', as(techUser))
        .send({ containerId: 'c', warehouseId: 'w', requestId: randomUUID() })
        .expect(403);
    });

    it('403s a role without containers.view', async () => {
      await request(app.getHttpServer()).get(BASE).set('x-test-user', as(noAccessUser)).expect(403);
      await request(app.getHttpServer())
        .get(`${BASE}/any/diff?containerId=c`)
        .set('x-test-user', as(noAccessUser))
        .expect(403);
    });
  });
});
