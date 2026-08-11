import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { JobSuperStatus, ClientType, type JwtUser } from '@bitcrm/types';
import {
  setupApp,
  teardownApp,
  cleanupData,
  createTestUserHeader,
  seededJobTypeId,
  getInternalHttpMock,
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

// A function, not a const: the catalog job-type id is only known after setup
// seeds it in beforeAll. `import`ed `seededJobTypeId` is a live binding.
const validDealPayload = () => ({
  contactId: '550e8400-e29b-41d4-a716-446655440000',
  clientType: ClientType.RESIDENTIAL,
  serviceArea: 'Atlanta Metro',
  address: { street: '123 Main St', city: 'Atlanta', state: 'GA', zip: '30301' },
  jobTypeId: seededJobTypeId,
});

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
        .send(validDealPayload())
        .expect(201);

      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBeDefined();
      expect(res.body.data.dealNumber).toBeDefined();
      expect(res.body.data.superStatus).toBe(JobSuperStatus.SUBMITTED);
      expect(res.body.data.contactId).toBe(validDealPayload().contactId);
    });

    it('should create deal as dispatcher (201)', async () => {
      const res = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(dispatcherUser))
        .send(validDealPayload())
        .expect(201);

      expect(res.body.data.assignedDispatcherId).toBe('dispatcher-1');
    });

    it('should reject technician creating deal (403)', async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(techUser))
        .send(validDealPayload())
        .expect(403);
    });

    it('should reject read-only user (403)', async () => {
      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(readOnlyUser))
        .send(validDealPayload())
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
        .send(validDealPayload())
        .expect(401);
    });
  });

  describe('GET /api/deals', () => {
    it('should list deals with pagination', async () => {
      // Create two deals
      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());

      await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());

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
        .send(validDealPayload());

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
        .send(validDealPayload());
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .put(`${BASE}/${id}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ notes: 'Updated notes' })
        .expect(200);

      expect(res.body.data.notes).toBe('Updated notes');
    });

    // The ValidationPipe transforms the body into DTO class instances, so the
    // address arrives as an AddressDto. The deal write succeeds, but the timeline
    // entry stored the raw class instance, which the DynamoDB marshaller rejected
    // — a 500 *after* the address had already changed. Guards that regression.
    it('should update the address without a 500', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .put(`${BASE}/${id}`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ address: { street: '999 New Rd', city: 'Atlanta', state: 'GA', zip: '30303' } })
        .expect(200);

      expect(res.body.data.address.street).toBe('999 New Rd');
    });
  });

  describe('DELETE /api/deals/:id', () => {
    it('should soft delete as admin', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
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
        .send(validDealPayload());
      const id = created.body.data.id;

      await request(app.getHttpServer())
        .delete(`${BASE}/${id}`)
        .set('x-test-user', createTestUserHeader(dispatcherUser))
        .expect(403);
    });
  });

  // ─── STATUS MOVES ─────────────────────────────────────

  describe('PUT /api/deals/:id/status', () => {
    it('should allow a user with move_status to move the super-status', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .put(`${BASE}/${id}/status`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ superStatus: JobSuperStatus.IN_PROGRESS })
        .expect(200);

      expect(res.body.data.superStatus).toBe(JobSuperStatus.IN_PROGRESS);
    });

    it('should reject a user without move_status (403)', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
      const id = created.body.data.id;

      // Read-only user lacks deals.move_status.
      await request(app.getHttpServer())
        .put(`${BASE}/${id}/status`)
        .set('x-test-user', createTestUserHeader(readOnlyUser))
        .send({ superStatus: JobSuperStatus.IN_PROGRESS })
        .expect(403);
    });

    it('should require cancellationReason for canceled', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
      const id = created.body.data.id;

      await request(app.getHttpServer())
        .put(`${BASE}/${id}/status`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ superStatus: JobSuperStatus.CANCELED })
        .expect(400);
    });

    it('should allow canceled with reason', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .put(`${BASE}/${id}/status`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ superStatus: JobSuperStatus.CANCELED, cancellationReason: 'Client resolved' })
        .expect(200);

      expect(res.body.data.superStatus).toBe(JobSuperStatus.CANCELED);
    });
  });

  // ─── TIMELINE ─────────────────────────────────────────

  describe('GET /api/deals/:id/timeline', () => {
    it('should return timeline with CREATED event after deal creation', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
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
        .send(validDealPayload());
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

  const TECH_1 = '550e8400-e29b-41d4-a716-446655440001';
  const TECH_2 = '550e8400-e29b-41d4-a716-446655440002';

  describe('POST /api/deals/:id/assign', () => {
    it('assigns multiple techs and auto-transitions to ASSIGNED', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
      const id = created.body.data.id;

      const res = await request(app.getHttpServer())
        .post(`${BASE}/${id}/assign`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ techIds: [TECH_1, TECH_2] })
        .expect(201);

      expect(res.body.data.assignedTechIds).toEqual(expect.arrayContaining([TECH_1, TECH_2]));
      expect(res.body.data.superStatus).toBe(JobSuperStatus.IN_PROGRESS);
    });
  });

  describe('POST /api/deals/:id/unassign', () => {
    it('removes one tech and keeps the rest', async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
      const id = created.body.data.id;

      await request(app.getHttpServer())
        .post(`${BASE}/${id}/assign`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ techIds: [TECH_1, TECH_2] });

      const res = await request(app.getHttpServer())
        .post(`${BASE}/${id}/unassign`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ techId: TECH_1 })
        .expect(201);

      expect(res.body.data.assignedTechIds).toEqual([TECH_2]);
    });
  });

  // ─── LINE ITEMS (products / services / to-order) ──────

  describe('POST /api/deals/:id/products', () => {
    const http = getInternalHttpMock();

    const createDeal = async () => {
      const created = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send(validDealPayload());
      return created.body.data.id as string;
    };

    const assign = (id: string, techIds: string[]) =>
      request(app.getHttpServer())
        .post(`${BASE}/${id}/assign`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ techIds });

    const baseLine = {
      productId: 'product-1', name: 'Deadbolt', sku: 'KW-001',
      quantity: 2, costCompany: 15, costForTech: 20, priceClient: 45,
    };

    beforeEach(() => {
      http.getProduct.mockResolvedValue({ id: 'product-1', name: 'Deadbolt', sku: 'KW-001', type: 'product' });
      http.deductStock.mockClear();
    });

    it('adds a sourced line and deducts from the tech container', async () => {
      const id = await createDeal();
      await assign(id, [TECH_1]);

      await request(app.getHttpServer())
        .post(`${BASE}/${id}/products`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ ...baseLine, fulfillment: 'sourced', sourceTechId: TECH_1 })
        .expect(201);

      expect(http.deductStock).toHaveBeenCalledTimes(1);

      const list = await request(app.getHttpServer())
        .get(`${BASE}/${id}/products`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .expect(200);
      expect(list.body.data[0].fulfillment).toBe('sourced');
    });

    it('adds a service line with no tech and no stock deduction', async () => {
      http.getProduct.mockResolvedValue({ id: 'svc-1', name: 'Rekey', sku: 'SVC-1', type: 'service' });
      const id = await createDeal();

      await request(app.getHttpServer())
        .post(`${BASE}/${id}/products`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ ...baseLine, productId: 'svc-1', name: 'Rekey', sku: 'SVC-1', fulfillment: 'service' })
        .expect(201);

      expect(http.deductStock).not.toHaveBeenCalled();
      const list = await request(app.getHttpServer())
        .get(`${BASE}/${id}/products`)
        .set('x-test-user', createTestUserHeader(adminUser));
      expect(list.body.data[0].fulfillment).toBe('service');
    });

    it('adds a to-order line without deducting stock, then marks it ordered', async () => {
      const id = await createDeal();

      await request(app.getHttpServer())
        .post(`${BASE}/${id}/products`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ ...baseLine, fulfillment: 'to_order' })
        .expect(201);

      expect(http.deductStock).not.toHaveBeenCalled();

      await request(app.getHttpServer())
        .patch(`${BASE}/${id}/products/product-1/ordered`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ ordered: true })
        .expect(200);

      const list = await request(app.getHttpServer())
        .get(`${BASE}/${id}/products`)
        .set('x-test-user', createTestUserHeader(adminUser));
      expect(list.body.data[0].fulfillment).toBe('to_order');
      expect(list.body.data[0].orderedAt).toBeDefined();
    });

    it('rejects a service-type product added as a sourced line (400)', async () => {
      http.getProduct.mockResolvedValue({ id: 'svc-1', name: 'Rekey', sku: 'SVC-1', type: 'service' });
      const id = await createDeal();
      await assign(id, [TECH_1]);

      await request(app.getHttpServer())
        .post(`${BASE}/${id}/products`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ ...baseLine, productId: 'svc-1', fulfillment: 'sourced', sourceTechId: TECH_1 })
        .expect(400);
    });
  });

  describe('job sequencing', () => {
    const TECH = TECH_1;
    const DATE = '2026-07-16';

    const createFor = async (slot: string) => {
      const res = await request(app.getHttpServer())
        .post(BASE)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ ...validDealPayload(), scheduledDate: DATE, scheduledTimeSlot: slot });
      return res.body.data.id as string;
    };

    const assign = (id: string) =>
      request(app.getHttpServer())
        .post(`${BASE}/${id}/assign`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ techIds: [TECH] });

    const seqOf = async (id: string) => {
      const res = await request(app.getHttpServer())
        .get(`${BASE}/${id}`)
        .set('x-test-user', createTestUserHeader(adminUser));
      return res.body.data.sequences?.[TECH] as number;
    };

    it('numbers a technician’s jobs by scheduled time on assignment', async () => {
      const pm = await createFor('15:00-18:00');
      const am = await createFor('09:00-12:00');
      await assign(pm);
      await assign(am);

      expect(await seqOf(am)).toBe(1);
      expect(await seqOf(pm)).toBe(2);
    });

    it('reorders on demand', async () => {
      const a = await createFor('09:00-12:00');
      const b = await createFor('13:00-15:00');
      await assign(a);
      await assign(b);

      await request(app.getHttpServer())
        .post(`${BASE}/reorder`)
        .set('x-test-user', createTestUserHeader(adminUser))
        .send({ techId: TECH, orderedDealIds: [b, a] })
        .expect(201);

      expect(await seqOf(b)).toBe(1);
      expect(await seqOf(a)).toBe(2);
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
