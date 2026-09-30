import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ClientType, ServiceAreaType, type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, cleanupData, createTestUserHeader, seededJobTypeId } from './setup';

const BASE = '/api/deals';
const admin: JwtUser = { id: 'admin-1', cognitoSub: 's1', email: 'a@t.com', roleId: 'role-admin', department: 'HQ' };
const readOnly: JwtUser = { id: 'ro-1', cognitoSub: 's2', email: 'ro@t.com', roleId: 'role-read-only', department: 'HQ' };
const hdr = (u: JwtUser) => ['x-test-user', createTestUserHeader(u)] as const;
const SECRET = ['x-internal-secret', 'test-secret'] as const;

describe('Deal billing E2E', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await setupApp(); });
  afterAll(async () => teardownApp());
  afterEach(async () => cleanupData());

  async function createDeal(extra: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app.getHttpServer()).post(BASE).set(...hdr(admin)).send({
      contactId: '550e8400-e29b-41d4-a716-446655440000',
      clientType: ClientType.RESIDENTIAL,
      address: { street: '1 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
      jobTypeId: seededJobTypeId,
      ...extra,
    }).expect(201);
    return res.body.data.id;
  }

  async function createArea(extra: Record<string, unknown> = {}): Promise<string> {
    const res = await request(app.getHttpServer()).post(`${BASE}/service-areas`).set(...hdr(admin)).send({
      name: 'Metro',
      type: ServiceAreaType.POLYGON,
      vertices: [
        { lat: 33.7, lng: -84.4 }, { lat: 33.7, lng: -84.3 },
        { lat: 33.8, lng: -84.3 }, { lat: 33.8, lng: -84.4 },
      ],
      ...extra,
    }).expect(201);
    return res.body.data.id;
  }

  it("applies the area's tax on create, then manual tax, discount and totals", async () => {
    const areaId = await createArea({ tax: { name: 'GA', ratePercent: 10 } });
    const id = await createDeal({ serviceAreaId: areaId });

    const deal = await request(app.getHttpServer()).get(`${BASE}/${id}`).set(...hdr(admin)).expect(200);
    expect(deal.body.data).toMatchObject({
      taxSource: 'service_area', taxRateId: areaId, taxRateName: 'GA', taxRatePercent: 10, itemCount: 0,
    });

    await request(app.getHttpServer()).post(`${BASE}/${id}/products`).set(...hdr(admin)).send({
      productId: 'product-1', name: 'Rekey', sku: 'RK', quantity: 2,
      costCompany: 1, costForTech: 1, priceClient: 50, fulfillment: 'to_order',
    }).expect(201);

    await request(app.getHttpServer()).patch(`${BASE}/${id}/discount`).set(...hdr(admin))
      .send({ discount: { type: 'amount', value: 10 } }).expect(200);

    const totals = await request(app.getHttpServer()).get(`${BASE}/${id}/totals`).set(...hdr(admin)).expect(200);
    expect(totals.body.data).toMatchObject({ subtotal: 100, discount: 10, tax: 9, total: 99 });

    await request(app.getHttpServer()).patch(`${BASE}/${id}/products/product-1/taxable`).set(...hdr(admin))
      .send({ taxable: false }).expect(200);
    const manual = await request(app.getHttpServer()).patch(`${BASE}/${id}/tax`).set(...hdr(admin))
      .send({ taxRateId: null }).expect(200);
    expect(manual.body.data.taxSource).toBe('manual');

    const needs = await request(app.getHttpServer()).get(`${BASE}?needsInvoice=true`).set(...hdr(admin)).expect(200);
    expect(needs.body.data.map((d: { id: string }) => d.id)).toContain(id);

    await request(app.getHttpServer()).patch(`${BASE}/internal/${id}/invoice-link`).set(...SECRET)
      .send({ invoiceId: id }).expect(204);
    const after = await request(app.getHttpServer()).get(`${BASE}?needsInvoice=true`).set(...hdr(admin)).expect(200);
    expect(after.body.data.map((d: { id: string }) => d.id)).not.toContain(id);
  });

  it('has no tax without an area tax (no account default) and accepts an area id manually', async () => {
    const areaId = await createArea({ tax: { name: 'CT', ratePercent: 6.35 } });
    const id = await createDeal();
    const deal = await request(app.getHttpServer()).get(`${BASE}/${id}`).set(...hdr(admin)).expect(200);
    expect(deal.body.data.taxSource).toBe('none');

    const manual = await request(app.getHttpServer()).patch(`${BASE}/${id}/tax`).set(...hdr(admin))
      .send({ taxRateId: areaId }).expect(200);
    expect(manual.body.data).toMatchObject({ taxSource: 'manual', taxRateId: areaId, taxRatePercent: 6.35 });
    await request(app.getHttpServer()).patch(`${BASE}/${id}/tax`).set(...hdr(admin))
      .send({ taxRateId: 'not-an-area' }).expect(400);
  });

  it('assigns a company: area default → billing default, explicit, update, filter', async () => {
    const areaId = await createArea({ defaultBusinessProfileId: 'bp-north' });
    const inArea = await createDeal({ serviceAreaId: areaId });
    const plain = await createDeal();

    const a = await request(app.getHttpServer()).get(`${BASE}/${inArea}`).set(...hdr(admin)).expect(200);
    expect(a.body.data).toMatchObject({ businessProfileId: 'bp-north', businessProfileName: 'North Co' });
    const b = await request(app.getHttpServer()).get(`${BASE}/${plain}`).set(...hdr(admin)).expect(200);
    expect(b.body.data).toMatchObject({ businessProfileId: 'bp-default', businessProfileName: 'Default Co' });

    await request(app.getHttpServer()).post(BASE).set(...hdr(admin)).send({
      contactId: '550e8400-e29b-41d4-a716-446655440000',
      clientType: ClientType.RESIDENTIAL,
      address: { street: '1 Main', city: 'Atlanta', state: 'GA', zip: '30301' },
      jobTypeId: seededJobTypeId,
      businessProfileId: 'bp-old',
    }).expect(400);

    const moved = await request(app.getHttpServer()).put(`${BASE}/${plain}`).set(...hdr(admin))
      .send({ businessProfileId: 'bp-north' }).expect(200);
    expect(moved.body.data).toMatchObject({ businessProfileId: 'bp-north', businessProfileName: 'North Co' });

    const filtered = await request(app.getHttpServer())
      .get(`${BASE}?businessProfileId=bp-north`).set(...hdr(admin)).expect(200);
    expect(filtered.body.data.map((d: { id: string }) => d.id).sort()).toEqual([inArea, plain].sort());

    const view = await request(app.getHttpServer()).get(`${BASE}/internal/${plain}/billing-view`).set(...SECRET).expect(200);
    expect(view.body.data).toMatchObject({ businessProfileId: 'bp-north', businessProfileName: 'North Co' });
  });

  it('serves the billing view and timeline internally, secret required', async () => {
    const id = await createDeal();
    const view = await request(app.getHttpServer()).get(`${BASE}/internal/${id}/billing-view`).set(...SECRET).expect(200);
    expect(view.body.data).toMatchObject({ deal: { id }, items: [], totals: { total: 0 } });

    await request(app.getHttpServer()).post(`${BASE}/internal/${id}/timeline`).set(...SECRET)
      .send({ type: 'invoice_created', actorId: 'admin-1', metadata: { total: 0 } }).expect(204);
    await request(app.getHttpServer()).get(`${BASE}/internal/${id}/billing-view`).expect(403);
  });

  it('enforces deals.edit on tax changes', async () => {
    const id = await createDeal();
    await request(app.getHttpServer()).patch(`${BASE}/${id}/tax`).set(...hdr(readOnly)).send({ taxRateId: null }).expect(403);
    await request(app.getHttpServer()).get(`${BASE}/${id}/totals`).expect(401);
  });
});
