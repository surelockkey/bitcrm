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
  id: 'na-1',
  cognitoSub: 'sub-na',
  email: 'na@test.com',
  roleId: 'role-no-access',
  department: 'HQ',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE = '/api/inventory/user-containers';
const CONTAINERS = '/api/inventory/containers';
const LOG = '/api/inventory/inventory-log';

const as = (user: JwtUser) => createTestUserHeader(user);

describe('User containers E2E', () => {
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

  const createVan = async (name: string) =>
    (
      await request(app.getHttpServer())
        .post(CONTAINERS)
        .set('x-test-user', as(adminUser))
        .send({ name, department: 'Atlanta' })
        .expect(201)
    ).body.data;

  const assign = (userId: string, body: Record<string, unknown>, user: JwtUser = adminUser) =>
    request(app.getHttpServer()).put(`${BASE}/${userId}`).set('x-test-user', as(user)).send(body);

  it('assigns a van, lists it, and the technician sees it as their own', async () => {
    const van = await createVan('(12) MIKE');

    const res = await assign(techUser.id, {
      userName: 'Mike Ross',
      access: 'container',
      containerId: van.id,
      limited: true,
    }).expect(200);
    expect(res.body.data).toMatchObject({
      userId: techUser.id,
      userName: 'Mike Ross',
      access: 'container',
      containerId: van.id,
      containerName: '(12) MIKE',
      limited: true,
      updatedBy: adminUser.id,
      updatedByName: adminUser.email,
    });

    const list = await request(app.getHttpServer()).get(BASE).set('x-test-user', as(adminUser)).expect(200);
    expect(list.body.data.map((r: { userId: string }) => r.userId)).toEqual([techUser.id]);

    await request(app.getHttpServer()).get(`${BASE}/${techUser.id}`).set('x-test-user', as(adminUser)).expect(200);

    const users = await request(app.getHttpServer())
      .get(`${CONTAINERS}/${van.id}/users`)
      .set('x-test-user', as(adminUser))
      .expect(200);
    expect(users.body.data.map((r: { userId: string }) => r.userId)).toEqual([techUser.id]);

    const me = await request(app.getHttpServer()).get(`${BASE}/me`).set('x-test-user', as(techUser)).expect(200);
    expect(me.body.data.containerId).toBe(van.id);

    const my = await request(app.getHttpServer()).get(`${CONTAINERS}/my`).set('x-test-user', as(techUser)).expect(200);
    expect(my.body.data.id).toBe(van.id);

    const scoped = await request(app.getHttpServer()).get(CONTAINERS).set('x-test-user', as(techUser)).expect(200);
    expect(scoped.body.data.map((c: { id: string }) => c.id)).toEqual([van.id]);
  });

  it('moves a technician to another van and logs container_assigned', async () => {
    const first = await createVan('Van A');
    const second = await createVan('Van B');

    await assign(techUser.id, { userName: 'Mike', access: 'container', containerId: first.id }).expect(200);
    await assign(techUser.id, { userName: 'Mike', access: 'container', containerId: second.id }).expect(200);

    const left = await request(app.getHttpServer())
      .get(`${CONTAINERS}/${first.id}/users`)
      .set('x-test-user', as(adminUser))
      .expect(200);
    expect(left.body.data).toEqual([]);

    const log = await request(app.getHttpServer())
      .get(`${LOG}?action=container_assigned`)
      .set('x-test-user', as(adminUser))
      .expect(200);
    expect(log.body.data[0]).toMatchObject({
      action: 'container_assigned',
      subjectUserId: techUser.id,
      fromId: first.id,
      toId: second.id,
      userId: adminUser.id,
    });
    expect(log.body.data[0].productId).toBeUndefined();
  });

  it('gives "All locations" no van and drops the user from the van list', async () => {
    const van = await createVan('Van A');
    await assign(techUser.id, { userName: 'Mike', access: 'container', containerId: van.id }).expect(200);

    const res = await assign(techUser.id, { userName: 'Mike', access: 'all', limited: true }).expect(200);
    expect(res.body.data.containerId).toBeUndefined();
    expect(res.body.data.limited).toBe(false);

    const users = await request(app.getHttpServer())
      .get(`${CONTAINERS}/${van.id}/users`)
      .set('x-test-user', as(adminUser))
      .expect(200);
    expect(users.body.data).toEqual([]);
  });

  // Workiz "All locations": the technician's assigned_only scope shows every van.
  it('shows every van to a technician with "All locations"', async () => {
    const a = await createVan('Van A');
    const b = await createVan('Van B');
    await assign(techUser.id, { userName: 'Mike', access: 'all' }).expect(200);

    const res = await request(app.getHttpServer()).get(CONTAINERS).set('x-test-user', as(techUser)).expect(200);
    expect(res.body.data.map((c: { id: string }) => c.id).sort()).toEqual([a.id, b.id].sort());

    await assign(techUser.id, { userName: 'Mike', access: 'none' }).expect(200);
    const none = await request(app.getHttpServer()).get(CONTAINERS).set('x-test-user', as(techUser)).expect(200);
    expect(none.body.data).toEqual([]);
  });

  it('validates the body and the container', async () => {
    await assign(techUser.id, { userName: 'Mike', access: 'container' }).expect(400);
    await assign(techUser.id, { userName: 'Mike', access: 'everything' }).expect(400);
    await assign(techUser.id, { userName: 'Mike', access: 'container', containerId: 'missing' }).expect(404);

    const van = await createVan('Old van');
    await request(app.getHttpServer())
      .put(`${CONTAINERS}/${van.id}`)
      .set('x-test-user', as(adminUser))
      .send({ status: 'archived' })
      .expect(200);
    await assign(techUser.id, { userName: 'Mike', access: 'container', containerId: van.id }).expect(400);
  });

  it('404s for a user with no row and for an unknown container', async () => {
    await request(app.getHttpServer()).get(`${BASE}/nobody`).set('x-test-user', as(adminUser)).expect(404);
    await request(app.getHttpServer()).get(`${BASE}/me`).set('x-test-user', as(techUser)).expect(404);
    await request(app.getHttpServer())
      .get(`${CONTAINERS}/missing/users`)
      .set('x-test-user', as(adminUser))
      .expect(404);
  });

  describe('authorization', () => {
    it('401s without a user', async () => {
      await request(app.getHttpServer()).get(BASE).expect(401);
      await request(app.getHttpServer()).get(`${BASE}/me`).expect(401);
      await request(app.getHttpServer()).put(`${BASE}/tech-1`).send({ userName: 'x', access: 'none' }).expect(401);
    });

    it('403s a technician (containers.view only) on a change', async () => {
      await assign('tech-2', { userName: 'Ann', access: 'none' }, techUser).expect(403);
    });

    it('403s a role without containers.view on the list and the van users', async () => {
      await request(app.getHttpServer()).get(BASE).set('x-test-user', as(noAccessUser)).expect(403);
      await request(app.getHttpServer())
        .get(`${CONTAINERS}/any/users`)
        .set('x-test-user', as(noAccessUser))
        .expect(403);
    });
  });
});
