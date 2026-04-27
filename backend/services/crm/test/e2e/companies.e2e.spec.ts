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

const superAdminUser: JwtUser = {
  id: 'superadmin-1',
  cognitoSub: 'sub-superadmin',
  email: 'superadmin@test.com',
  roleId: 'role-super-admin',
  department: 'HQ',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const COMPANIES_BASE = '/api/crm/companies';
const CONTACTS_BASE = '/api/crm/contacts';

function validCompanyPayload(overrides: Record<string, any> = {}) {
  return {
    title: `Acme Corp ${Date.now()}`,
    phones: ['(404) 555-9999'],
    emails: ['info@acme.com'],
    address: '456 Business Ave',
    clientType: 'commercial',
    ...overrides,
  };
}

function validContactPayload(overrides: Record<string, any> = {}) {
  return {
    firstName: 'John',
    lastName: 'Doe',
    phones: [`(404) 555-${String(Date.now()).slice(-4)}`],
    type: 'residential',
    source: 'manual',
    ...overrides,
  };
}

async function createCompany(
  app: INestApplication,
  user: JwtUser,
  overrides: Record<string, any> = {},
) {
  const res = await request(app.getHttpServer())
    .post(COMPANIES_BASE)
    .set('x-test-user', createTestUserHeader(user))
    .send(validCompanyPayload(overrides))
    .expect(201);
  return res.body.data;
}

async function createContact(
  app: INestApplication,
  user: JwtUser,
  overrides: Record<string, any> = {},
) {
  const res = await request(app.getHttpServer())
    .post(CONTACTS_BASE)
    .set('x-test-user', createTestUserHeader(user))
    .send(validContactPayload(overrides))
    .expect(201);
  return res.body.data;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Companies E2E', () => {
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

  it('POST /companies - admin creates company successfully (201)', async () => {
    const payload = validCompanyPayload();
    const res = await request(app.getHttpServer())
      .post(COMPANIES_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(payload)
      .expect(201);

    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.title).toBe(payload.title);
    expect(res.body.data.clientType).toBe('commercial');
    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.createdBy).toBe('admin-1');
  });

  it('POST /companies - dispatcher gets 403', async () => {
    await request(app.getHttpServer())
      .post(COMPANIES_BASE)
      .set('x-test-user', createTestUserHeader(dispatcherUser))
      .send(validCompanyPayload())
      .expect(403);
  });

  it('POST /companies - technician gets 403', async () => {
    await request(app.getHttpServer())
      .post(COMPANIES_BASE)
      .set('x-test-user', createTestUserHeader(techUser))
      .send(validCompanyPayload())
      .expect(403);
  });

  it('POST /companies - validation error (missing title) gets 400', async () => {
    const { title, ...noTitle } = validCompanyPayload();
    await request(app.getHttpServer())
      .post(COMPANIES_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(noTitle)
      .expect(400);
  });

  it('POST /companies - validation error (invalid clientType) gets 400', async () => {
    await request(app.getHttpServer())
      .post(COMPANIES_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send(validCompanyPayload({ clientType: 'invalid' }))
      .expect(400);
  });

  // ---- LIST ----

  it('GET /companies - lists companies with pagination', async () => {
    await createCompany(app, adminUser, { title: 'Company A' });
    await createCompany(app, adminUser, { title: 'Company B' });

    const res = await request(app.getHttpServer())
      .get(COMPANIES_BASE)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    expect(res.body.pagination).toBeDefined();
  });

  it('GET /companies?clientType=commercial - filters by client type', async () => {
    await createCompany(app, adminUser, { clientType: 'commercial' });
    await createCompany(app, adminUser, { clientType: 'government' });

    const res = await request(app.getHttpServer())
      .get(`${COMPANIES_BASE}?clientType=commercial`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    for (const company of res.body.data) {
      expect(company.clientType).toBe('commercial');
    }
  });

  it('GET /companies - read-only user can view companies', async () => {
    await createCompany(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(COMPANIES_BASE)
      .set('x-test-user', createTestUserHeader(readOnlyUser))
      .expect(200);

    expect(res.body.success).toBe(true);
  });

  // ---- GET BY ID ----

  it('GET /companies/:id - gets company by ID', async () => {
    const company = await createCompany(app, adminUser);

    const res = await request(app.getHttpServer())
      .get(`${COMPANIES_BASE}/${company.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(company.id);
  });

  it('GET /companies/:id - nonexistent returns 404', async () => {
    await request(app.getHttpServer())
      .get(`${COMPANIES_BASE}/nonexistent-id`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(404);
  });

  // ---- UPDATE ----

  it('PUT /companies/:id - updates company', async () => {
    const company = await createCompany(app, adminUser);

    const res = await request(app.getHttpServer())
      .put(`${COMPANIES_BASE}/${company.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .send({ title: 'Updated Corp', notes: 'VIP' })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.title).toBe('Updated Corp');
    expect(res.body.data.notes).toBe('VIP');
  });

  it('PUT /companies/:id - technician gets 403', async () => {
    const company = await createCompany(app, adminUser);

    await request(app.getHttpServer())
      .put(`${COMPANIES_BASE}/${company.id}`)
      .set('x-test-user', createTestUserHeader(techUser))
      .send({ title: 'Hacked' })
      .expect(403);
  });

  // ---- DELETE ----

  it('DELETE /companies/:id - super admin soft-deletes company', async () => {
    const company = await createCompany(app, superAdminUser);

    const res = await request(app.getHttpServer())
      .delete(`${COMPANIES_BASE}/${company.id}`)
      .set('x-test-user', createTestUserHeader(superAdminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.deleted).toBe(true);
  });

  it('DELETE /companies/:id - admin with delete=false gets 403', async () => {
    const company = await createCompany(app, superAdminUser);

    // admin role has companies.delete=false
    await request(app.getHttpServer())
      .delete(`${COMPANIES_BASE}/${company.id}`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(403);
  });

  // ---- COMPANY CONTACTS ----

  it('GET /companies/:id/contacts - lists contacts linked to company', async () => {
    const company = await createCompany(app, adminUser);
    await createContact(app, adminUser, { companyId: company.id });
    await createContact(app, adminUser, { companyId: company.id });

    const res = await request(app.getHttpServer())
      .get(`${COMPANIES_BASE}/${company.id}/contacts`)
      .set('x-test-user', createTestUserHeader(adminUser))
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
  });

  // ---- AUTH ----

  it('GET /companies - unauthenticated returns 401', async () => {
    await request(app.getHttpServer()).get(COMPANIES_BASE).expect(401);
  });
});
