import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DealStage, ClientType, type JwtUser } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
} from './setup';

const BASE = '/api/deals';

const adminUser: JwtUser = {
  id: 'admin-1', cognitoSub: 'sub-1', email: 'admin@test.com',
  roleId: 'role-admin', department: 'HQ',
};

const dispatcherUser: JwtUser = {
  id: 'dispatcher-1', cognitoSub: 'sub-2', email: 'dispatch@test.com',
  roleId: 'role-dispatcher', department: 'Atlanta',
};

const techUser: JwtUser = {
  id: 'tech-1', cognitoSub: 'sub-3', email: 'tech@test.com',
  roleId: 'role-technician', department: 'Atlanta',
};

const readOnlyUser: JwtUser = {
  id: 'readonly-1', cognitoSub: 'sub-4', email: 'readonly@test.com',
  roleId: 'role-read-only', department: 'HQ',
};

const validDealPayload = {
  contactId: '550e8400-e29b-41d4-a716-446655440000',
  clientType: ClientType.RESIDENTIAL,
  serviceArea: 'Atlanta Metro',
  address: { street: '123 Main St', city: 'Atlanta', state: 'GA', zip: '30301' },
  jobType: 'lockout',
};

describe('Deals E2E', () => {
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

  // ─── CRUD ─────────────────────────────────────────────

  describe('POST /api/deals', () => {
    it('should create deal as admin (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload)
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.dealNumber).toBeDefined();
      expect(res.body.data.stage).toBe(DealStage.NEW_LEAD);
      expect(res.body.data.contactId).toBe(validDealPayload.contactId);
    });

    it('should create deal as dispatcher (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(dispatcherUser))
        .send(validDealPayload)
        .expect(201);

      expect(res.body.data.assignedDispatcherId).toBe('dispatcher-1');
    });

    it('should reject technician creating deal (403)', async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(techUser))
        .send(validDealPayload)
        .expect(403);
    });

    it('should reject read-only user (403)', async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(readOnlyUser))
        .send(validDealPayload)
        .expect(403);
    });

    it('should reject invalid payload (400)', async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ contactId: 'not-a-uuid' })
        .expect(400);
    });

    it('should reject unauthenticated (401)', async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .send(validDealPayload)
        .expect(401);
    });
  });

  describe('GET /api/deals', () => {
    it('should list deals with pagination', async () => {
      // Create two deals
      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);

      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);

      const res = await request(app.getHttpServer())
        .get(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(2);
      expect(res.body.pagination).toBeDefined();
    });
  });

  describe('GET /api/deals/:id', () => {
    it('should get deal by ID', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);

      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .get(`${BASE}/${id}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(200);

      expect(res.body.data.id).toBe(id);
    });

    it('should return 404 for nonexistent deal', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/nonexistent-id`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(404);
    });
  });

  describe('PUT /api/deals/:id', () => {
    it('should update deal fields', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .put(`${BASE}/${id}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ notes: 'Updated notes' })
        .expect(200);

      expect(res.body.data.notes).toBe('Updated notes');
    });
  });

  describe('DELETE /api/deals/:id', () => {
    it('should soft delete as admin', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .delete(`${BASE}/${id}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(200);

      expect(res.body.data.deleted).toBe(true);
    });

    it('should reject dispatcher delete (403)', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      await request(app.getHttpServer())
        .delete(`${BASE}/${id}`)
        .set('x-test-user', createTestUserHeader(dispatcherUser))
        .expect(403);
    });
  });

  // ─── STAGE TRANSITIONS ────────────────────────────────

  describe('PUT /api/deals/:id/stage', () => {
    it('should allow admin to transition any stage', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .put(`${BASE}/${id}/stage`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ stage: DealStage.ASSIGNED })
        .expect(200);

      expect(res.body.data.stage).toBe(DealStage.ASSIGNED);
    });

    it('should reject unauthorized transition (403)', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      // Read-only user has empty transitions
      await request(app.getHttpServer())
        .put(`${BASE}/${id}/stage`)
        .set('x-test-user', createTestUserHeader(readOnlyUser))
        .send({ stage: DealStage.ASSIGNED })
        .expect(403);
    });

    it('should require cancellationReason for canceled', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      await request(app.getHttpServer())
        .put(`${BASE}/${id}/stage`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ stage: DealStage.CANCELED })
        .expect(400);
    });

    it('should allow canceled with reason', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .put(`${BASE}/${id}/stage`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ stage: DealStage.CANCELED, cancellationReason: 'Client resolved' })
        .expect(200);

      expect(res.body.data.stage).toBe(DealStage.CANCELED);
    });
  });

  // ─── TIMELINE ─────────────────────────────────────────

  describe('GET /api/deals/:id/timeline', () => {
    it('should return timeline with CREATED event after deal creation', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .get(`${BASE}/${id}/timeline`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(200);

      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.data[0].eventType).toBe('created');
    });
  });

  describe('POST /api/deals/:id/notes', () => {
    it('should add note to timeline', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      await request(app.getHttpServer())
        .post(`${BASE}/${id}/notes`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ note: 'Test note' })
        .expect(201);

      const timeline = await request(app.getHttpServer())
        .get(`${BASE}/${id}/timeline`)
        .set('x-test-user', createTestUserHeader(adminUser));

      const noteEntry = timeline.body.data.find((e: any) => e.eventType === 'note_added');
      expect(noteEntry).toBeDefined();
      expect(noteEntry.note).toBe('Test note');
    });
  });

  // ─── ASSIGNMENT ───────────────────────────────────────

  describe('POST /api/deals/:id/assign', () => {
    it('should assign tech and auto-transition to ASSIGNED', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`${BASE}/${id}/assign`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ techId: '550e8400-e29b-41d4-a716-446655440001' })
        .expect(201);

      expect(res.body.data.assignedTechId).toBe('550e8400-e29b-41d4-a716-446655440001');
      expect(res.body.data.stage).toBe(DealStage.ASSIGNED);
    });
  });

  describe('POST /api/deals/:id/unassign', () => {
    it('should unassign tech', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload);
      const id = created.body.data.id;

      // First assign
      await request(app.getHttpServer())
        .post(`${BASE}/${id}/assign`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ techId: '550e8400-e29b-41d4-a716-446655440001' });

      // Then unassign
      const res = await request(app.getHttpServer())
        .post(`${BASE}/${id}/unassign`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(201);

      expect(res.body.success).toBe(true);
    });
  });

  // ─── INTERNAL ─────────────────────────────────────────

  describe('GET /api/deals/internal/by-tech/:techId', () => {
    it('should return deals with valid secret', async () => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/internal/by-tech/tech-1`)
        .set('x-internal-secret', 'test-secret')
        .expect(200);

      expect(res.body.success).toBe(true);
    });

    it('should reject without secret (403)', async () => {
      await request(app.getHttpServer())
        .get(`${BASE}/internal/by-tech/tech-1`)
        .expect(403);
    });
  });
});
