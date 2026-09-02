import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, cleanupData, createTestUserHeader } from './setup';

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

const CATEGORIES = '/api/inventory/categories';
const BRANDS = '/api/inventory/brands';
const PRODUCTS = '/api/inventory/products';

describe('Item catalogs E2E (categories + brands)', () => {
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

  const create = (base: string, name: string, user: JwtUser = adminUser) =>
    request(app.getHttpServer())
      .post(base)
      .set('x-test-user', createTestUserHeader(user))
      .send({ name });

  describe.each([
    ['categories', CATEGORIES],
    ['brands', BRANDS],
  ])('%s', (_label, BASE) => {
    it('admin creates, lists, updates', async () => {
      const created = await create(BASE, 'Alpha').expect(201);
      expect(created.body.data.name).toBe('Alpha');
      expect(created.body.data.active).toBe(true);

      await create(BASE, 'beta').expect(201);

      const list = await request(app.getHttpServer())
        .get(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(200);
      expect(list.body.data.map((c: { name: string }) => c.name)).toEqual(['Alpha', 'beta']);

      const updated = await request(app.getHttpServer())
        .put(`${BASE}/${created.body.data.id}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ active: false })
        .expect(200);
      expect(updated.body.data.active).toBe(false);
    });

    it('rejects a duplicate name with 409', async () => {
      await create(BASE, 'Alpha').expect(201);
      await create(BASE, ' alpha ').expect(409);
    });

    it('technician can view but not create (403)', async () => {
      await create(BASE, 'Viewable').expect(201);

      await request(app.getHttpServer())
        .get(BASE)
        .set('x-test-user', createTestUserHeader(techUser))
        .expect(200);

      await create(BASE, 'Nope', techUser).expect(403);
    });

    it('deletes an unreferenced entry outright', async () => {
      const created = await create(BASE, 'Gone').expect(201);

      const res = await request(app.getHttpServer())
        .delete(`${BASE}/${created.body.data.id}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(200);
      expect(res.body.data).toMatchObject({ archived: false, deleted: true });

      await request(app.getHttpServer())
        .get(`${BASE}/${created.body.data.id}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(404);
    });
  });

  it('archives a category still used by an item instead of deleting it', async () => {
    const created = await create(CATEGORIES, 'Locks').expect(201);

    await request(app.getHttpServer())
      .post(PRODUCTS)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({
        sku: 'SKU-CAT-1',
        name: 'Deadbolt',
        category: 'Locks',
        type: 'product',
        costCompany: 10,
        costTech: 15,
        priceClient: 25,
        serialTracking: false,
        minimumStockLevel: 0,
      })
      .expect(201);

    const res = await request(app.getHttpServer())
      .delete(`${CATEGORIES}/${created.body.data.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);
    expect(res.body.data).toMatchObject({ archived: true, deleted: false });

    const after = await request(app.getHttpServer())
      .get(`${CATEGORIES}/${created.body.data.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);
    expect(after.body.data.active).toBe(false);
  });
});
