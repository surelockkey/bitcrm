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

const dispatcherUser: JwtUser = {
  id: 'dispatcher-1',
  cognitoSub: 'sub-dispatcher',
  email: 'dispatcher@test.com',
  roleId: 'role-dispatcher',
  department: 'Atlanta',
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
const BASE = '/api/crm/contacts';

function validContactPayload(overrides: Record<string, any> = {}) {
  return {
    firstName: 'John',
    lastName: 'Doe',
    phones: [`(404) 555-${String(Date.now()).slice(-4)}`],
    emails: ['john@example.com'],
    type: 'residential',
    source: 'manual',
    ...overrides,
  };
}

async function createContact(
  app: INestApplication,
  user: JwtUser,
  overrides: Record<string, any> = {},
) {
  const res = await request(app.getHttpServer())
    .post(BASE)
    .set('x-test-user', createTestUserHeader(user))
    .send(validContactPayload(overrides))
    .expect(201);
  return res.body.data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Contacts E2E', () => {
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

  it('POST /contacts - admin creates contact successfully (201)', async () => {
    const payload = validContactPayload();
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.firstName).toBe('John');
    expect(res.body.data.lastName).toBe('Doe');
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.phones[0]).toMatch(/^\+1/);
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.createdBy).toBe('admin-1');
  });

  it('POST /contacts - dispatcher can create contacts', async () => {
    const res = await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(dispatcherUser))
      .send(validContactPayload())
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.createdBy).toBe('dispatcher-1');
  });

  it('POST /contacts - technician gets 403', async () => {
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(techUser))
      .send(validContactPayload())
      .expect(403);
  });

  it('POST /contacts - validation error (missing firstName) gets 400', async () => {
    const { firstName, ...noFirstName } = validContactPayload();
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(noFirstName)
      .expect(400);
  });

  it('POST /contacts - validation error (empty phones) gets 400', async () => {
    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(validContactPayload({ phones: [] }))
      .expect(400);
  });

  it('POST /contacts - duplicate phone gets 409', async () => {
    const phone = '(770) 555-0001';
    await createContact(app, adminUser, { phones: [phone] });

    await request(app.getHttpServer())
      .post(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(validContactPayload({ phones: [phone] }))
      .expect(409);
  });

  // ---- LIST ----

  it('GET /contacts - lists contacts with pagination', async () => {
    await createContact(app, adminUser, { firstName: 'Alice' });
    await createContact(app, adminUser, { firstName: 'Bob' });

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination).toBeDefined();
  });

  it('GET /contacts - read-only user can view contacts', async () => {
    await createContact(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(BASE)
      .set('x-test-user', createTestUserHeader(readOnlyUser))
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  it('GET /contacts - paginates through all contacts', async () => {
    await createContact(app, adminUser, { firstName: 'A' });
    await createContact(app, adminUser, { firstName: 'B' });
    await createContact(app, adminUser, { firstName: 'C' });

    // Scan limit applies to raw DynamoDB items (including phone index items),
    // so we paginate until all contacts are collected.
    const allContacts: any[] = [];
    let cursor: string | undefined;
    do {
      const res = await request(app.getHttpServer())
        .get(`${BASE}?limit=100${cursor ? `&cursor=${cursor}` : ''}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(200);

      allContacts.push(...res.body.data);
      cursor = res.body.pagination.nextCursor;
    } while (cursor);

    expect(allContacts.length).toBe(3);
  });

  // ---- GET BY ID ----

  it('GET /contacts/:id - gets contact by ID', async () => {
    const contact = await createContact(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(`${BASE}/${contact.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(contact.id);
  });

  it('GET /contacts/:id - nonexistent returns 404', async () => {
    await request(app.getHttpServer())
      .get(`${BASE}/nonexistent-id`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(404);
  });

  // ---- SEARCH BY PHONE ----

  it('GET /contacts/search/by-phone - finds contact by phone', async () => {
    const phone = '(678) 555-0099';
    const contact = await createContact(app, adminUser, { phones: [phone] });

    const res = await request(app.getHttpServer())
      .get(`${BASE}/search/by-phone?phone=${encodeURIComponent(phone)}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data).not.toBeNull();
    expect(res.body.data.id).toBe(contact.id);
  });

  it('GET /contacts/search/by-phone - returns null when not found', async () => {
    const res = await request(app.getHttpServer())
      .get(`${BASE}/search/by-phone?phone=${encodeURIComponent('(999) 999-9999')}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.data).toBeNull();
  });

  // ---- UPDATE ----

  it('PUT /contacts/:id - updates contact', async () => {
    const contact = await createContact(app, adminUser);

    const res = await request(app.getHttpServer())
      .put(`${BASE}/${contact.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ firstName: 'Jane', notes: 'Updated' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.firstName).toBe('Jane');
    expect(res.body.data.notes).toBe('Updated');
  });

  it('PUT /contacts/:id - technician gets 403', async () => {
    const contact = await createContact(app, adminUser);

    await request(app.getHttpServer())
      .put(`${BASE}/${contact.id}`)
      .set('x-test-user', createTestUserHeader(techUser))
      .send({ firstName: 'Hacker' })
      .expect(403);
  });

  // ---- DELETE ----

  it('DELETE /contacts/:id - soft-deletes contact', async () => {
    const contact = await createContact(app, adminUser);

    const res = await request(app.getHttpServer())
      .delete(`${BASE}/${contact.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(true);
  });

  it('DELETE /contacts/:id - dispatcher gets 403', async () => {
    const contact = await createContact(app, adminUser);

    await request(app.getHttpServer())
      .delete(`${BASE}/${contact.id}`)
      .set('x-test-user', createTestUserHeader(dispatcherUser))
      .expect(403);
  });

  // ---- FIND OR CREATE (INTERNAL) ----

  it('POST /contacts/find-or-create - creates new contact when not found', async () => {
    const res = await request(app.getHttpServer())
      .post(`${BASE}/find-or-create`)
      .set('x-internal-secret', 'test-secret')
      .send({ phone: '(555) 111-2222', firstName: 'New', lastName: 'Person' })
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data.created).toBe(true);
    expect(res.body.data.contact.firstName).toBe('New');
  });

  it('POST /contacts/find-or-create - returns existing contact when phone matches', async () => {
    const phone = '(555) 333-4444';
    await createContact(app, adminUser, { phones: [phone], firstName: 'Existing' });

    const res = await request(app.getHttpServer())
      .post(`${BASE}/find-or-create`)
      .set('x-internal-secret', 'test-secret')
      .send({ phone, firstName: 'Ignored', lastName: 'Ignored' })
      .expect(201);

    expect(res.body.data.created).toBe(false);
    expect(res.body.data.contact.firstName).toBe('Existing');
  });

  it('POST /contacts/find-or-create - rejects without internal secret', async () => {
    await request(app.getHttpServer())
      .post(`${BASE}/find-or-create`)
      .send({ phone: '(555) 555-5555' })
      .expect(403);
  });

  // ---- AUTH ----

  it('GET /contacts - unauthenticated returns 401', async () => {
    await request(app.getHttpServer()).get(BASE).expect(401);
  });
});
