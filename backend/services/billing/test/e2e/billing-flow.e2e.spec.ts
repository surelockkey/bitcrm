import { isDeepStrictEqual } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { calculateDocumentTotals, type DocumentDiscount, type DocumentTotals } from '@bitcrm/types';
import type Redis from 'ioredis';
import {
  E2E_TECH,
  SERVICES,
  TECH_AUTH,
  bootService,
  call,
  destroyClients,
  dropTables,
  eventually,
  purgeDealEventsQueue,
  resetTables,
  seedPermissions,
  stopService,
} from './setup';

/**
 * The billing feature end to end, across crm (4002), inventory (4004),
 * deal (4003) and billing (4008), with LocalStack SNS/SQS/S3 and headless
 * Chrome. Needs: `docker compose up -d dynamodb-local localstack`, a Redis on
 * 127.0.0.1:6379 and `npm run setup:aws` (backend/). Steps share state and run
 * in order.
 *
 *   npm run test:e2e -w billing-service          (from backend/)
 *   E2E_SLOW_MS=300 npm run test:e2e -w billing-service   (+ slow-call log)
 */

const CRM = 'http://localhost:4002/api/crm';
const INV = 'http://localhost:4004/api/inventory';
const DEAL = 'http://localhost:4003/api/deals';
const BILL = 'http://localhost:4008/api/billing';

jest.setTimeout(120_000);

const RUN = Date.now().toString(36);
const phone = (n: number) => `+1860555${String((Date.now() + n) % 10_000).padStart(4, '0')}`;

interface Line {
  productId: string;
  quantity: number;
  priceClient: number;
  taxable?: boolean;
}

const totalsOf = (lines: Line[], taxRatePercent: number, discount?: DocumentDiscount): DocumentTotals =>
  calculateDocumentTotals({ lines, taxRatePercent, discount });

async function fetchBytes(url: string): Promise<{ status: number; bytes: Buffer; headers: Headers }> {
  const res = await fetch(url);
  return { status: res.status, bytes: Buffer.from(await res.arrayBuffer()), headers: res.headers };
}

const isPdf = (b: Buffer) => b.subarray(0, 4).toString('latin1') === '%PDF';

// A 1×1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('billing — cross-service flow', () => {
  const apps: INestApplication[] = [];
  let redis: Redis | undefined;

  // Shared state, filled in step order.
  const s = {} as {
    /** Area taxes (Revision 2): a TaxRate's id IS its service area's id. */
    areaA: string;
    areaG: string;
    areaId: string;
    bpMain: any;
    bpBrand: any;
    dealBrand: any;
    jobTypeId: string;
    contact: any;
    contact2: any;
    deal: any;
    deal2: any;
    service: any;
    part: any;
    lines: Line[];
    e1: any;
    e2: any;
    e3: any;
    e4: any;
    otherEstimate: any;
    template: any;
    token: string;
    deal3: any;
    container: any;
  };

  beforeAll(async () => {
    await resetTables();
    await purgeDealEventsQueue();
    redis = await seedPermissions();
    for (const spec of SERVICES) apps.push(await bootService(spec));
  }, 180_000);

  afterAll(async () => {
    for (const app of [...apps].reverse()) await stopService(app).catch(() => undefined);
    await redis?.quit();
    await dropTables();
    destroyClients();
  }, 60_000);

  it('0. real guards are in front of every service', async () => {
    expect((await call('GET', `${BILL}/invoices`, { auth: false })).status).toBe(401);
    expect((await call('GET', `${DEAL}/tax-rates`, { auth: false })).status).toBe(401);
    // Internal routes demand the shared secret.
    expect((await call('GET', `${DEAL}/internal/tax-rates`, { auth: false })).status).toBe(403);
  });

  const polygon = (lat: number, lng: number) => [
    { lat, lng },
    { lat: lat + 0.2, lng },
    { lat: lat + 0.2, lng: lng + 0.3 },
    { lat, lng: lng + 0.3 },
  ];

  it('1. companies (first = default) and taxed service areas A (6.35%) and G (14.35%)', async () => {
    const main = await call('POST', `${BILL}/business-profiles`, { body: { name: `Main Locks ${RUN}` } });
    expect(main.status).toBe(201);
    s.bpMain = main.body.data;
    expect(s.bpMain).toMatchObject({ isDefault: true, active: true, defaultPaymentTerms: 'cash' });

    const brand = await call('POST', `${BILL}/business-profiles`, {
      body: { name: `Brand Keys ${RUN}`, defaultPaymentTerms: 'net15', phone: '+18605550199' },
    });
    expect(brand.status).toBe(201);
    s.bpBrand = brand.body.data;
    expect(s.bpBrand.isDefault).toBe(false);
    // Write = settings.edit.
    expect((await call('POST', `${BILL}/business-profiles`, { auth: TECH_AUTH, body: { name: 'x' } })).status).toBe(403);

    const a = await call('POST', `${DEAL}/service-areas`, {
      body: {
        name: `State ${RUN}`,
        type: 'polygon',
        vertices: polygon(40.0, -74.3),
        tax: { name: `State tax ${RUN}`, ratePercent: 6.35 },
        defaultBusinessProfileId: s.bpBrand.id,
      },
    });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({
      tax: { name: `State tax ${RUN}`, ratePercent: 6.35 },
      defaultBusinessProfileId: s.bpBrand.id,
    });
    s.areaA = a.body.data.id;

    const g = await call('POST', `${DEAL}/service-areas`, {
      body: { name: `Combined ${RUN}`, type: 'polygon', vertices: polygon(39.0, -74.3), tax: { name: `Combined ${RUN}`, ratePercent: 14.35 } },
    });
    expect(g.status).toBe(201);
    s.areaG = g.body.data.id;

    expect(
      (await call('POST', `${DEAL}/service-areas`, {
        body: { name: 'Bad', type: 'polygon', vertices: polygon(38.0, -74.3), tax: { name: 'Bad', ratePercent: 1.2345 } },
      })).status,
    ).toBe(400);
    expect(
      (await call('POST', `${DEAL}/service-areas`, {
        body: { name: 'Bad co', type: 'polygon', vertices: polygon(37.0, -74.3), defaultBusinessProfileId: 'bp-nope' },
      })).status,
    ).toBe(400);
    // The catalog is gone: rates are read-only and derived from the areas.
    expect((await call('POST', `${DEAL}/tax-rates`, { body: { name: 'x', ratePercent: 1 } })).status).toBe(404);

    const list = await call('GET', `${DEAL}/tax-rates`);
    expect(list.status).toBe(200);
    expect(list.body.data.map((r: any) => r.id).sort()).toEqual([s.areaA, s.areaG].sort());
    expect(list.body.data.find((r: any) => r.id === s.areaA)).toMatchObject({
      name: `State tax ${RUN}`,
      ratePercent: 6.35,
      serviceAreaId: s.areaA,
      serviceAreaName: `State ${RUN}`,
      isGroup: false,
      isDefault: false,
    });
  });

  it('2. service area Hartford with an 8% tax (polygon, no geocoding)', async () => {
    const res = await call('POST', `${DEAL}/service-areas`, {
      body: {
        name: `Hartford ${RUN}`,
        type: 'polygon',
        timezone: 'America/New_York',
        vertices: [
          { lat: 41.7, lng: -72.8 },
          { lat: 41.9, lng: -72.8 },
          { lat: 41.9, lng: -72.5 },
          { lat: 41.7, lng: -72.5 },
        ],
        tax: { name: `City ${RUN}`, ratePercent: 8 },
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.tax).toEqual({ name: `City ${RUN}`, ratePercent: 8 });
    s.areaId = res.body.data.id;

    const jt = await call('POST', `${DEAL}/job-types`, { body: { name: `Lockout ${RUN}`, priority: 10 } });
    expect(jt.status).toBe(201);
    s.jobTypeId = jt.body.data.id;
  });

  const dealBody = (contactId: string) => ({
    contactId,
    clientType: 'residential',
    jobTypeId: s.jobTypeId,
    serviceAreaId: s.areaId,
    address: { street: '1 Main St', city: 'Hartford', state: 'CT', zip: '06103', lat: 41.76, lng: -72.67 },
  });

  it("3. contact (not exempt) + job → the area's tax and the default company", async () => {
    const c = await call('POST', `${CRM}/contacts`, {
      body: {
        firstName: 'Ada',
        lastName: `Client${RUN}`,
        phones: [phone(1)],
        emails: [`ada.${RUN}@example.com`],
        type: 'residential',
        source: 'manual',
      },
    });
    expect(c.status).toBe(201);
    s.contact = c.body.data;
    expect(s.contact.taxExempt ?? false).toBe(false);

    const d = await call('POST', DEAL, { body: dealBody(s.contact.id) });
    expect(d.status).toBe(201);
    s.deal = d.body.data;
    expect(s.deal).toMatchObject({
      taxRateId: s.areaId,
      taxRateName: `City ${RUN}`,
      taxRatePercent: 8,
      taxSource: 'service_area',
      itemCount: 0,
      businessProfileId: s.bpMain.id,
      businessProfileName: `Main Locks ${RUN}`,
    });
  });

  it("3b. job company: area default → explicit → edit (timeline) → filter; unknown company 400", async () => {
    // Area A defaults to the brand company; no documents are ever made for this job.
    const inA = await call('POST', DEAL, { body: { ...dealBody(s.contact.id), serviceAreaId: s.areaA } });
    expect(inA.status).toBe(201);
    s.dealBrand = inA.body.data;
    expect(s.dealBrand).toMatchObject({
      businessProfileId: s.bpBrand.id,
      businessProfileName: `Brand Keys ${RUN}`,
      taxRateId: s.areaA,
      taxRatePercent: 6.35,
    });

    const explicit = await call('POST', DEAL, { body: { ...dealBody(s.contact.id), businessProfileId: s.bpBrand.id } });
    expect(explicit.status).toBe(201);
    expect(explicit.body.data.businessProfileId).toBe(s.bpBrand.id);
    expect((await call('POST', DEAL, { body: { ...dealBody(s.contact.id), businessProfileId: 'bp-nope' } })).status).toBe(400);

    const moved = await call('PUT', `${DEAL}/${explicit.body.data.id}`, { body: { businessProfileId: s.bpMain.id } });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ businessProfileId: s.bpMain.id, businessProfileName: `Main Locks ${RUN}` });
    const timeline = await call('GET', `${DEAL}/${explicit.body.data.id}/timeline?limit=50`);
    expect(timeline.body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: 'field_updated',
          details: expect.objectContaining({ field: 'businessProfileId', oldValue: s.bpBrand.id, newValue: s.bpMain.id }),
        }),
      ]),
    );

    const brandJobs = await call('GET', `${DEAL}?businessProfileId=${s.bpBrand.id}&limit=100`);
    expect(brandJobs.body.data.map((d: any) => d.id)).toEqual([s.dealBrand.id]);

    // Tidy: this job plays no further part.
    expect((await call('DELETE', `${DEAL}/${explicit.body.data.id}`)).status).toBe(200);
  });

  it('4. an invoice needs items → 422', async () => {
    const res = await call('POST', `${BILL}/invoices`, { body: { dealId: s.deal.id } });
    expect(res.status).toBe(422);
  });

  it('5. two job items from inventory (taxable by default) and live totals', async () => {
    const base = { category: 'E2E', costCompany: 10, costTech: 12, serialTracking: false, minimumStockLevel: 0 };
    const svc = await call('POST', `${INV}/products`, {
      body: { ...base, name: `Rekey ${RUN}`, sku: `SVC-${RUN}`, type: 'service', priceClient: 95.5 },
    });
    expect(svc.status).toBe(201);
    s.service = svc.body.data;
    const part = await call('POST', `${INV}/products`, {
      body: { ...base, name: `Deadbolt ${RUN}`, sku: `PRT-${RUN}`, type: 'product', priceClient: 42.25 },
    });
    expect(part.status).toBe(201);
    s.part = part.body.data;
    expect(s.service.taxable).toBe(true);
    expect(s.part.taxable).toBe(true);

    const add = (p: any, quantity: number, fulfillment: string) =>
      call('POST', `${DEAL}/${s.deal.id}/products`, {
        body: {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          quantity,
          costCompany: p.costCompany,
          costForTech: p.costTech,
          priceClient: p.priceClient,
          fulfillment,
        },
      });
    expect((await add(s.service, 1, 'service')).status).toBe(201);
    expect((await add(s.part, 2, 'to_order')).status).toBe(201);

    const items = await call('GET', `${DEAL}/${s.deal.id}/products`);
    expect(items.status).toBe(200);
    const byId = new Map<string, any>(items.body.data.map((i: any) => [i.productId, i]));
    expect(byId.get(s.service.id)).toMatchObject({ fulfillment: 'service', taxable: true });
    expect(byId.get(s.part.id)).toMatchObject({ fulfillment: 'to_order', taxable: true });

    s.lines = [
      { productId: s.service.id, quantity: 1, priceClient: 95.5, taxable: true },
      { productId: s.part.id, quantity: 2, priceClient: 42.25, taxable: true },
    ];
    const totals = await call('GET', `${DEAL}/${s.deal.id}/totals`);
    expect(totals.status).toBe(200);
    expect(totals.body.data).toEqual(totalsOf(s.lines, 8));

    const deal = await call('GET', `${DEAL}/${s.deal.id}`);
    expect(deal.body.data.itemCount).toBe(2);
  });

  it('6. create the invoice (id/number are the job’s), once', async () => {
    const needs = await call('GET', `${BILL}/invoices/needing-invoice`);
    expect(needs.status).toBe(200);
    expect(needs.body.data.map((r: any) => r.id)).toContain(s.deal.id);

    const res = await call('POST', `${BILL}/invoices`, { body: { dealId: s.deal.id } });
    expect(res.status).toBe(201);
    const inv = res.body.data;
    expect(inv).toMatchObject({
      id: s.deal.id,
      dealId: s.deal.id,
      number: s.deal.dealNumber,
      contactId: s.contact.id,
      status: 'due',
      paymentTerms: 'cash',
      taxRateId: s.areaId,
      taxSource: 'service_area',
    });
    // The job's company (Main) defaults to "due on receipt": due the day it is issued.
    expect(inv.dueDate).toBe(inv.invoiceDate);
    expect(inv.totals).toEqual(totalsOf(s.lines, 8));
    expect(inv.items).toHaveLength(2);

    const deal = await call('GET', `${DEAL}/${s.deal.id}`);
    expect(deal.body.data.invoiceId).toBe(s.deal.id);

    const again = await call('POST', `${BILL}/invoices`, { body: { dealId: s.deal.id } });
    expect(again.status).toBe(409);

    // Terms drive the due date.
    const net30 = await call('PATCH', `${BILL}/invoices/${s.deal.id}`, { body: { paymentTerms: 'net30' } });
    expect(net30.status).toBe(200);
    const expectedDue = new Date(Date.parse(`${inv.invoiceDate}T00:00:00Z`) + 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    expect(net30.body.data).toMatchObject({ paymentTerms: 'net30', dueDate: expectedDue, status: 'due' });

    const byDeal = await call('GET', `${BILL}/invoices/by-deal/${s.deal.id}`);
    expect(byDeal.body.data.id).toBe(s.deal.id);
  });

  it("7. taxable toggle + discount + another area's tax by hand → live invoice, event-refreshed snapshot, auto tax", async () => {
    const tx = await call('PATCH', `${DEAL}/${s.deal.id}/products/${s.part.id}/taxable`, { body: { taxable: false } });
    expect(tx.status).toBe(200);
    expect(tx.body.data.taxable).toBe(false);
    const disc = await call('PATCH', `${DEAL}/${s.deal.id}/discount`, {
      body: { discount: { type: 'percent', value: 10 } },
    });
    expect(disc.status).toBe(200);
    expect((await call('PATCH', `${DEAL}/${s.deal.id}/tax`, { body: { taxRateId: 'not-an-area' } })).status).toBe(400);
    const tax = await call('PATCH', `${DEAL}/${s.deal.id}/tax`, { body: { taxRateId: s.areaG } });
    expect(tax.status).toBe(200);
    expect(tax.body.data).toMatchObject({ taxRateId: s.areaG, taxRatePercent: 14.35, taxSource: 'manual' });

    s.lines[1].taxable = false;
    const expected = totalsOf(s.lines, 14.35, { type: 'percent', value: 10 });
    expect((await call('GET', `${DEAL}/${s.deal.id}/totals`)).body.data).toEqual(expected);

    // The stored snapshot (list + summary) is refreshed by deal-events over SQS —
    // polled BEFORE any GET /invoices/:id, which would refresh it itself.
    await eventually(
      async () => {
        const list = await call('GET', `${BILL}/invoices?limit=50`);
        const row = list.body.data.items.find((i: any) => i.id === s.deal.id);
        return row && isDeepStrictEqual(row.totals, expected);
      },
      { label: 'invoice snapshot refreshed from deal-events' },
    );
    const summary = await call('GET', `${BILL}/invoices/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body.data).toMatchObject({ dueCount: 1, dueAmount: expected.balanceDue, unsentCount: 1 });

    const inv = await call('GET', `${BILL}/invoices/${s.deal.id}`);
    expect(inv.status).toBe(200);
    expect(inv.body.data.totals).toEqual(expected);
    expect(inv.body.data).toMatchObject({
      taxRateId: s.areaG,
      taxSource: 'manual',
      discount: { type: 'percent', value: 10 },
    });
    expect(inv.body.data.items.find((i: any) => i.productId === s.part.id).taxable).toBe(false);

    const auto = await call('POST', `${DEAL}/${s.deal.id}/tax/auto`);
    expect(auto.status).toBe(201);
    expect(auto.body.data).toMatchObject({ taxRateId: s.areaId, taxRatePercent: 8, taxSource: 'service_area' });
  });

  it('8. tax-exempt contact → auto tax is exempt, 0 tax', async () => {
    const upd = await call('PUT', `${CRM}/contacts/${s.contact.id}`, {
      body: { taxExempt: true, taxExemptReason: 'Nonprofit' },
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data).toMatchObject({ taxExempt: true, taxExemptReason: 'Nonprofit' });

    const auto = await call('POST', `${DEAL}/${s.deal.id}/tax/auto`);
    expect(auto.status).toBe(201);
    expect(auto.body.data.taxSource).toBe('exempt');
    expect(auto.body.data.taxRateId).toBeUndefined();

    const totals = await call('GET', `${DEAL}/${s.deal.id}/totals`);
    expect(totals.body.data.tax).toBe(0);
    expect(totals.body.data).toEqual(totalsOf(s.lines, 0, { type: 'percent', value: 10 }));
    const inv = await call('GET', `${BILL}/invoices/${s.deal.id}`);
    expect(inv.body.data).toMatchObject({ taxSource: 'exempt' });
    expect(inv.body.data.totals.tax).toBe(0);
  });

  it('9. estimates: numbering, lines, tax, duplicate, statuses, sync to job', async () => {
    const n = s.deal.dealNumber;
    const e1 = await call('POST', `${BILL}/estimates`, { body: { dealId: s.deal.id, copyJobItems: true } });
    expect(e1.status).toBe(201);
    s.e1 = e1.body.data;
    expect(s.e1).toMatchObject({ number: `${n}-1`, status: 'unsent', taxSource: 'exempt' });
    expect(s.e1.items).toHaveLength(2);
    expect(s.e1.items.find((i: any) => i.productId === s.service.id).productType).toBe('service');
    expect(s.e1.items.find((i: any) => i.productId === s.part.id).taxable).toBe(false);

    const e2 = await call('POST', `${BILL}/estimates`, { body: { dealId: s.deal.id, name: 'Option B' } });
    expect(e2.status).toBe(201);
    s.e2 = e2.body.data;
    expect(s.e2).toMatchObject({ number: `${n}-2`, name: 'Option B', items: [] });

    const item = (p: any, quantity: number, extra: Record<string, unknown> = {}) => ({
      productId: p.id,
      productType: p.type,
      name: p.name,
      sku: p.sku,
      quantity,
      priceClient: p.priceClient,
      costCompany: p.costCompany,
      costForTech: p.costTech,
      ...extra,
    });
    const url = `${BILL}/estimates/${s.e2.id}`;
    let r = await call('POST', `${url}/items`, { body: item(s.service, 2) });
    expect(r.status).toBe(201);
    r = await call('POST', `${url}/items`, { body: item(s.part, 1) });
    expect(r.status).toBe(201);
    r = await call('POST', `${url}/items`, { body: item(s.part, 5, { description: 'to be removed' }) });
    expect(r.status).toBe(201);
    expect(r.body.data.items).toHaveLength(3);
    const [svcLine, partLine, extraLine] = [...r.body.data.items].sort((a: any, b: any) => a.position - b.position);

    // Edit: 1 → 3 deadbolts at a special price.
    r = await call('PUT', `${url}/items/${partLine.lineId}`, { body: item(s.part, 3, { priceClient: 40 }) });
    expect(r.status).toBe(200);
    // Reorder: reversed.
    r = await call('PUT', `${url}/items-order`, {
      body: { lineIds: [extraLine.lineId, partLine.lineId, svcLine.lineId] },
    });
    expect(r.status).toBe(200);
    expect(r.body.data.items.map((i: any) => i.lineId)).toEqual([extraLine.lineId, partLine.lineId, svcLine.lineId]);
    r = await call('DELETE', `${url}/items/${extraLine.lineId}`);
    expect(r.status).toBe(200);
    expect(r.body.data.items).toHaveLength(2);
    r = await call('PATCH', `${url}/items/${svcLine.lineId}/taxable`, { body: { taxable: false } });
    expect(r.status).toBe(200);

    // E2 was created while the job carried a 10% discount: it inherits it.
    expect(r.body.data.discount).toEqual({ type: 'percent', value: 10 });
    r = await call('PATCH', url, { body: { taxRateId: s.areaA } });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ taxRateId: s.areaA, taxRatePercent: 6.35, taxSource: 'manual' });
    const e2Lines: Line[] = [
      { productId: s.part.id, quantity: 3, priceClient: 40, taxable: true },
      { productId: s.service.id, quantity: 2, priceClient: 95.5, taxable: false },
    ];
    const tenPercent: DocumentDiscount = { type: 'percent', value: 10 };
    expect(r.body.data.totals).toEqual(totalsOf(e2Lines, 6.35, tenPercent));
    const fetched = await call('GET', url);
    expect(fetched.body.data.items.map((i: any) => i.lineId)).toEqual([partLine.lineId, svcLine.lineId]);

    const dup = await call('POST', `${BILL}/estimates/${s.e1.id}/duplicate`);
    expect(dup.status).toBe(201);
    s.e3 = dup.body.data;
    expect(s.e3).toMatchObject({ number: `${n}-3`, status: 'unsent' });
    expect(s.e3.items).toHaveLength(2);
    expect(s.e3.totals).toEqual(s.e1.totals);

    // Status transitions.
    r = await call('PATCH', `${BILL}/estimates/${s.e1.id}/status`, { body: { status: 'approved' } });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('approved');
    expect(r.body.data.approvedAt).toBeDefined();
    r = await call('PATCH', `${BILL}/estimates/${s.e1.id}/status`, { body: { status: 'declined' } });
    expect(r.body.data).toMatchObject({ status: 'declined' });
    expect(r.body.data.declinedAt).toBeDefined();
    r = await call('PATCH', `${BILL}/estimates/${s.e1.id}/status`, { body: { status: 'bogus' } });
    expect(r.status).toBe(400);

    r = await call('POST', `${BILL}/estimates/${s.e3.id}/mark-sent`, { body: { sent: true } });
    expect(r.status).toBe(200);
    expect(r.body.data.status).toBe('pending');
    expect(r.body.data.sentAt).toBeDefined();

    // Sync E2 → job.
    const sync = await call('POST', `${url}/sync-to-job`);
    expect(sync.status).toBe(200);
    expect(sync.body.data.itemCount).toBe(2);
    expect(sync.body.data.estimate.status).toBe('won');
    expect(sync.body.data.estimate.wonAt).toBeDefined();

    const jobItems = await call('GET', `${DEAL}/${s.deal.id}/products`);
    const byId = new Map<string, any>(jobItems.body.data.map((i: any) => [i.productId, i]));
    expect(jobItems.body.data).toHaveLength(2);
    expect(byId.get(s.service.id)).toMatchObject({ fulfillment: 'service', quantity: 2, taxable: false });
    expect(byId.get(s.part.id)).toMatchObject({ fulfillment: 'to_order', quantity: 3, priceClient: 40, taxable: true });

    const deal = await call('GET', `${DEAL}/${s.deal.id}`);
    expect(deal.body.data).toMatchObject({
      taxRateId: s.areaA,
      taxSource: 'manual',
      itemCount: 2,
      discount: tenPercent,
    });
    s.lines = e2Lines;
    expect((await call('GET', `${DEAL}/${s.deal.id}/totals`)).body.data).toEqual(totalsOf(e2Lines, 6.35, tenPercent));

    const timeline = await call('GET', `${DEAL}/${s.deal.id}/timeline?limit=100`);
    expect(timeline.status).toBe(200);
    const types = timeline.body.data.map((e: any) => e.eventType);
    expect(types).toEqual(
      expect.arrayContaining(['estimate_synced', 'estimate_created', 'invoice_created', 'tax_changed']),
    );

    // An empty estimate cannot be synced.
    const e4 = await call('POST', `${BILL}/estimates`, { body: { dealId: s.deal.id } });
    expect(e4.status).toBe(201);
    s.e4 = e4.body.data;
    expect(s.e4.number).toBe(`${n}-4`);
    const empty = await call('POST', `${BILL}/estimates/${s.e4.id}/sync-to-job`);
    expect(empty.status).toBe(422);

    const byDeal = await call('GET', `${BILL}/estimates/by-deal/${s.deal.id}`);
    expect(byDeal.body.data.map((e: any) => e.number)).toEqual([`${n}-1`, `${n}-2`, `${n}-3`, `${n}-4`]);

    // The invoice follows the job's new lines (live).
    const inv = await call('GET', `${BILL}/invoices/${s.deal.id}`);
    expect(inv.body.data.totals).toEqual(totalsOf(e2Lines, 6.35, tenPercent));
  });

  it('10. templates: seeds, preset, optimistic version, default, render html + pdf', async () => {
    const list = await call('GET', `${BILL}/templates`);
    expect(list.status).toBe(200);
    const defaults = list.body.data.filter((t: any) => t.isDefault);
    expect(defaults.map((t: any) => t.kind).sort()).toEqual(['estimate', 'invoice']);
    const seededInvoice = defaults.find((t: any) => t.kind === 'invoice');

    const presets = await call('GET', `${BILL}/templates/presets`);
    expect(presets.body.data.map((p: any) => p.id)).toEqual(expect.arrayContaining(['classic', 'modern', 'minimal']));

    const created = await call('POST', `${BILL}/templates`, {
      body: { name: 'Modern invoice', kind: 'invoice', presetId: 'modern' },
    });
    expect(created.status).toBe(201);
    s.template = created.body.data;
    expect(s.template).toMatchObject({ kind: 'invoice', preset: 'modern', version: 1, isDefault: false });

    const full = (await call('GET', `${BILL}/templates/${s.template.id}`)).body.data;
    const content = {
      page: full.page,
      header: full.header,
      body: full.body,
      footer: full.footer,
      visibility: full.visibility,
    };
    const ok = await call('PUT', `${BILL}/templates/${s.template.id}`, {
      body: { ...content, name: 'Modern invoice v2', version: 1 },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data).toMatchObject({ name: 'Modern invoice v2', version: 2 });
    // Nested block trees survive the ValidationPipe whitelist.
    expect(ok.body.data.body).toEqual(full.body);
    const stale = await call('PUT', `${BILL}/templates/${s.template.id}`, {
      body: { ...content, name: 'lost update', version: 1 },
    });
    expect(stale.status).toBe(409);

    const def = await call('POST', `${BILL}/templates/${s.template.id}/default`);
    expect(def.status).toBe(200);
    expect(def.body.data.isDefault).toBe(true);
    const after = (await call('GET', `${BILL}/templates`)).body.data;
    expect(after.find((t: any) => t.id === seededInvoice.id).isDefault).toBe(false);
    const del = await call('DELETE', `${BILL}/templates/${s.template.id}`);
    expect(del.status).toBe(409);

    const html = await call('POST', `${BILL}/templates/render`, {
      body: { kind: 'invoice', content, source: { kind: 'invoice', id: s.deal.id }, format: 'html' },
    });
    expect(html.status).toBe(200);
    expect(html.body.data.html).toContain(s.deal.dealNumber);

    const pdf = await call('POST', `${BILL}/templates/render`, {
      body: { kind: 'invoice', content, source: { kind: 'invoice', id: s.deal.id }, format: 'pdf' },
    });
    expect(pdf.status).toBe(200);
    const file = await fetchBytes(pdf.body.data.url);
    expect(file.status).toBe(200);
    expect(isPdf(file.bytes)).toBe(true);

    // The invoice preview renders with the new default template.
    const preview = await call('GET', `${BILL}/invoices/${s.deal.id}/html`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.html).toContain(s.deal.dealNumber);
  });

  it('11. invoice PDF: presigned S3 url, inline vs attachment', async () => {
    const inline = await call('GET', `${BILL}/invoices/${s.deal.id}/pdf`);
    expect(inline.status).toBe(200);
    const a = await fetchBytes(inline.body.data.url);
    expect(a.status).toBe(200);
    expect(isPdf(a.bytes)).toBe(true);
    expect(a.headers.get('content-type')).toBe('application/pdf');
    expect(a.headers.get('content-disposition')).toMatch(/^inline;/);

    const dl = await call('GET', `${BILL}/invoices/${s.deal.id}/pdf?download=1`);
    expect(dl.status).toBe(200);
    const b = await fetchBytes(dl.body.data.url);
    expect(b.status).toBe(200);
    expect(isPdf(b.bytes)).toBe(true);
    expect(b.headers.get('content-disposition')).toBe(`attachment; filename="Invoice-${s.deal.dealNumber}.pdf"`);

    const est = await call('GET', `${BILL}/estimates/${s.e2.id}/pdf`);
    expect(est.status).toBe(200);
    expect(isPdf((await fetchBytes(est.body.data.url)).bytes)).toBe(true);
  });

  it('12. client portal: sent documents only, ownership, regenerate, preview, rate limit', async () => {
    const link = await call('POST', `${BILL}/portal-links/${s.contact.id}`);
    expect(link.status).toBe(201);
    const { token, url } = link.body.data;
    expect(token).toEqual(expect.any(String));
    expect(url).toBe(`http://portal.e2e.test/portal/${token}`);
    expect(link.body.data.tokenHash).toBeUndefined();
    const stored = await call('GET', `${BILL}/portal-links/${s.contact.id}`);
    expect(stored.body.data).toMatchObject({ contactId: s.contact.id });
    expect(stored.body.data.token).toBeUndefined();

    expect((await call('POST', `${BILL}/invoices/${s.deal.id}/mark-sent`, { body: { sent: true } })).status).toBe(200);

    const view = await call('GET', `${BILL}/public/portal/${token}`, { auth: false });
    expect(view.status).toBe(200);
    expect(view.body.data).toMatchObject({
      preview: false,
      client: { firstName: 'Ada', lastName: `Client${RUN}` },
    });
    expect(view.body.data.invoices.map((d: any) => d.id)).toEqual([s.deal.id]);
    // Only E3 was sent; E1/E2/E4 stay hidden.
    expect(view.body.data.estimates.map((d: any) => d.id)).toEqual([s.e3.id]);

    const pub = (t: string, kind: string, id: string, headers?: Record<string, string>) =>
      call('GET', `${BILL}/public/portal/${t}/${kind}/${id}/pdf`, { auth: false, headers });
    const invPdf = await pub(token, 'invoice', s.deal.id);
    expect(invPdf.status).toBe(200);
    const file = await fetchBytes(invPdf.body.data.url);
    expect(isPdf(file.bytes)).toBe(true);
    expect(file.headers.get('content-disposition')).toMatch(/^inline;/);
    expect((await pub(token, 'estimate', s.e3.id)).status).toBe(200);
    expect((await pub(token, 'estimate', s.e1.id)).status).toBe(404); // not sent
    expect((await pub(token, 'receipt', s.deal.id)).status).toBe(404);

    // Another client's sent document is invisible through this token.
    const c2 = await call('POST', `${CRM}/contacts`, {
      body: { firstName: 'Bob', lastName: `Other${RUN}`, phones: [phone(2)], type: 'residential', source: 'manual' },
    });
    expect(c2.status).toBe(201);
    s.contact2 = c2.body.data;
    const d2 = await call('POST', DEAL, { body: dealBody(s.contact2.id) });
    expect(d2.status).toBe(201);
    s.deal2 = d2.body.data;
    const other = await call('POST', `${BILL}/estimates`, { body: { dealId: s.deal2.id } });
    expect(other.status).toBe(201);
    s.otherEstimate = other.body.data;
    expect((await call('POST', `${BILL}/estimates/${s.otherEstimate.id}/mark-sent`, { body: { sent: true } })).status).toBe(200);
    expect((await pub(token, 'estimate', s.otherEstimate.id)).status).toBe(404);

    const preview = await call('GET', `${BILL}/portal-links/${s.contact.id}/preview`);
    expect(preview.status).toBe(200);
    expect(preview.body.data.preview).toBe(true);
    expect(preview.body.data.estimates.map((d: any) => d.id).sort()).toEqual(
      [s.e1.id, s.e2.id, s.e3.id, s.e4.id].sort(),
    );

    const regen = await call('POST', `${BILL}/portal-links/${s.contact.id}`);
    expect(regen.status).toBe(201);
    s.token = regen.body.data.token;
    expect(s.token).not.toBe(token);
    expect((await call('GET', `${BILL}/public/portal/${token}`, { auth: false })).status).toBe(404);
    expect((await pub(token, 'invoice', s.deal.id)).status).toBe(404);
    expect((await call('GET', `${BILL}/public/portal/${s.token}`, { auth: false })).status).toBe(200);
    expect((await call('GET', `${BILL}/public/portal/not-a-token`, { auth: false })).status).toBe(404);

    // BILLING_PORTAL_RATE_LIMIT=30 per IP + token per minute.
    const ip = { 'x-forwarded-for': '203.0.113.9' };
    const statuses: number[] = [];
    for (let i = 0; i < 35; i++) {
      statuses.push((await call('GET', `${BILL}/public/portal/${s.token}`, { auth: false, headers: ip })).status);
    }
    expect(statuses.slice(0, 30).every((st) => st === 200)).toBe(true);
    expect(statuses.slice(30)).toEqual([429, 429, 429, 429, 429]);
    // A different client IP is counted separately.
    const other_ip = await call('GET', `${BILL}/public/portal/${s.token}`, {
      auth: false,
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(other_ip.status).toBe(200);
  });

  it('13. companies: compat profile + logo upload (presigned SSE-KMS PUT), unfinished upload, default, delete guards, portal branding', async () => {
    const asset = await call('POST', `${BILL}/assets`, {
      body: { contentType: 'image/png', fileName: 'logo.png', size: PNG.length },
    });
    expect(asset.status).toBe(201);
    const { id, uploadUrl, headers } = asset.body.data;
    expect(uploadUrl).toMatch(/^http:\/\/localhost:4566\//);
    expect(headers).toMatchObject({ 'Content-Type': 'image/png', 'x-amz-server-side-encryption': 'aws:kms' });
    const put = await fetch(uploadUrl, { method: 'PUT', headers, body: PNG });
    expect(put.status).toBe(200);

    const bad = await call('POST', `${BILL}/assets`, { body: { contentType: 'image/svg+xml' } });
    expect(bad.status).toBe(400);

    const profile = {
      name: `E2E Locksmiths ${RUN}`,
      phone: '+18605550100',
      email: 'office@e2e-locks.test',
      address: { street: '9 Elm St', city: 'Hartford', state: 'CT', zip: '06103' },
      logoAssetId: id,
      defaultPaymentTerms: 'net15',
      dueDateBasis: 'invoice_created',
    };
    const saved = await call('PUT', `${BILL}/business-profile`, { body: profile });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toMatchObject(profile);

    const got = await call('GET', `${BILL}/business-profile`);
    expect(got.status).toBe(200);
    expect(got.body.data).toMatchObject(profile);
    expect(got.body.data.logoUrl).toEqual(expect.any(String));
    const logo = await fetchBytes(got.body.data.logoUrl);
    expect(logo.status).toBe(200);
    expect(logo.bytes.equals(PNG)).toBe(true);

    const assetUrl = await call('GET', `${BILL}/assets/${id}/url`);
    expect(assetUrl.status).toBe(200);
    expect((await fetchBytes(assetUrl.body.data.url)).bytes.equals(PNG)).toBe(true);

    // The logo is inlined into documents (the PDF browser has no network).
    const html = await call('GET', `${BILL}/invoices/${s.deal.id}/html`);
    expect(html.body.data.html).toContain(profile.name);
    const portal = await call('GET', `${BILL}/public/portal/${s.token}`, {
      auth: false,
      headers: { 'x-forwarded-for': '203.0.113.11' },
    });
    expect(portal.body.data.business.name).toBe(profile.name);

    // The compat PUT wrote the default company.
    const companies = await call('GET', `${BILL}/business-profiles`);
    expect(companies.status).toBe(200);
    expect(companies.body.data.map((c: any) => c.id)).toEqual([s.bpMain.id, s.bpBrand.id]);
    expect(companies.body.data[0]).toMatchObject({ name: profile.name, logoAssetId: id, logoUrl: expect.any(String) });
    const internal = await call('GET', `${BILL}/business-profiles/internal`, {
      auth: false,
      headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET! },
    });
    expect(internal.status).toBe(200);
    expect(internal.body.data).toHaveLength(2);
    expect((await call('GET', `${BILL}/business-profiles/internal`, { auth: false })).status).toBe(403);

    // A logo whose upload never happened is refused.
    const pending = await call('POST', `${BILL}/assets`, { body: { contentType: 'image/png', fileName: 'x.png' } });
    expect(pending.status).toBe(201);
    const unfinished = await call('PUT', `${BILL}/business-profiles/${s.bpBrand.id}`, {
      body: { logoAssetId: pending.body.data.id },
    });
    expect(unfinished.status).toBe(422);

    // Partial update; null clears.
    const brandLogo = await call('PUT', `${BILL}/business-profiles/${s.bpBrand.id}`, {
      body: { logoAssetId: id, address: { street: '5 Oak', city: 'Hartford', state: 'CT', zip: '06103', lat: 41.76, lng: -72.67 } },
    });
    expect(brandLogo.status).toBe(200);
    expect(brandLogo.body.data).toMatchObject({ name: `Brand Keys ${RUN}`, phone: '+18605550199', address: { lat: 41.76 } });
    const cleared = await call('PUT', `${BILL}/business-profiles/${s.bpBrand.id}`, { body: { phone: null } });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.phone).toBeUndefined();
    expect(cleared.body.data.logoAssetId).toBe(id);

    // Default swap, and the delete guards.
    expect((await call('DELETE', `${BILL}/business-profiles/${s.bpMain.id}`)).status).toBe(409);
    const swapped = await call('POST', `${BILL}/business-profiles/${s.bpBrand.id}/default`);
    expect(swapped.status).toBe(200);
    expect((await call('GET', `${BILL}/business-profiles`)).body.data.map((c: any) => [c.id, c.isDefault])).toEqual([
      [s.bpBrand.id, true],
      [s.bpMain.id, false],
    ]);
    expect((await call('POST', `${BILL}/business-profiles/${s.bpMain.id}/default`)).status).toBe(200);
    expect((await call('GET', `${BILL}/business-profile`)).body.data.id).toBe(s.bpMain.id);

    const tpl = (await call('GET', `${BILL}/templates/${s.template.id}`)).body.data;
    const withRule = await call('PUT', `${BILL}/templates/${s.template.id}`, {
      body: {
        page: tpl.page,
        header: tpl.header,
        body: tpl.body,
        footer: tpl.footer,
        visibility: tpl.visibility,
        autoApply: { businessProfileIds: [s.bpBrand.id] },
        version: tpl.version,
      },
    });
    expect(withRule.status).toBe(200);
    expect(withRule.body.data.autoApply).toEqual({ businessProfileIds: [s.bpBrand.id] });
    expect((await call('DELETE', `${BILL}/business-profiles/${s.bpBrand.id}`)).status).toBe(409);
    const noRule = await call('PUT', `${BILL}/templates/${s.template.id}`, {
      body: { ...withRule.body.data, autoApply: null, version: withRule.body.data.version },
    });
    expect(noRule.status).toBe(200);

    // The portal is branded by the company of the most recently SENT document.
    const brandEst = await call('POST', `${BILL}/estimates`, { body: { dealId: s.dealBrand.id } });
    expect(brandEst.status).toBe(201);
    expect(
      (await call('POST', `${BILL}/estimates/${brandEst.body.data.id}/mark-sent`, { body: { sent: true } })).status,
    ).toBe(200);
    const branded = await call('GET', `${BILL}/public/portal/${s.token}`, {
      auth: false,
      headers: { 'x-forwarded-for': '203.0.113.12' },
    });
    expect(branded.body.data.business).toMatchObject({ name: `Brand Keys ${RUN}`, logoUrl: expect.any(String) });
    const summaries = new Map<string, any>(
      [...branded.body.data.invoices, ...branded.body.data.estimates].map((d: any) => [d.id, d]),
    );
    expect(summaries.get(brandEst.body.data.id).companyName).toBe(`Brand Keys ${RUN}`);
    expect(summaries.get(s.deal.id).companyName).toBe(profile.name);
    // The brand job's documents render the brand company.
    const brandHtml = await call('GET', `${BILL}/estimates/${brandEst.body.data.id}/html`);
    expect(brandHtml.body.data.html).toContain(`Brand Keys ${RUN}`);
    // Out of the way of the later steps' counts.
    expect((await call('DELETE', `${BILL}/estimates/${brandEst.body.data.id}`)).status).toBe(200);
  });

  it('14. deleting the invoice unlinks the job; canceling the job archives open estimates', async () => {
    const del = await call('DELETE', `${BILL}/invoices/${s.deal.id}`);
    expect(del.status).toBe(200);
    const deal = await call('GET', `${DEAL}/${s.deal.id}`);
    expect(deal.body.data.invoiceId).toBeUndefined();
    const items = await call('GET', `${DEAL}/${s.deal.id}/products`);
    expect(items.body.data).toHaveLength(2);
    expect((await call('GET', `${BILL}/invoices/by-deal/${s.deal.id}`)).body.data).toBeNull();
    expect((await call('GET', `${BILL}/invoices/${s.deal.id}`)).status).toBe(404);
    const needs = await call('GET', `${BILL}/invoices/needing-invoice`);
    expect(needs.body.data.map((r: any) => r.id)).toContain(s.deal.id);

    const cancel = await call('PUT', `${DEAL}/${s.deal.id}/status`, {
      body: { superStatus: 'canceled', cancellationReason: 'Client canceled' },
    });
    expect(cancel.status).toBe(200);
    expect(cancel.body.data.superStatus).toBe('canceled');

    const final = await eventually(
      async () => {
        const res = await call('GET', `${BILL}/estimates/by-deal/${s.deal.id}`);
        const byId = new Map<string, any>(res.body.data.map((e: any) => [e.id, e.status]));
        const archived = [s.e1.id, s.e3.id, s.e4.id].every((id) => byId.get(id) === 'archived');
        return archived ? byId : null;
      },
      { label: 'estimates archived after deal.status_changed' },
    );
    expect(final.get(s.e2.id)).toBe('won');

    // Other jobs' estimates are untouched.
    const other = await call('GET', `${BILL}/estimates/${s.otherEstimate.id}`);
    expect(other.body.data.status).toBe('pending');
    const summary = await call('GET', `${BILL}/estimates/summary`);
    expect(summary.body.data.archived.count).toBe(3);
    expect(summary.body.data.won.count).toBe(1);
  });
  it('15. technician stock: sync sources from the van, restores on re-sync; assigned_only scope', async () => {
    // A van for the technician, stocked through a warehouse.
    const wh = await call('POST', `${INV}/warehouses`, { body: { name: `WH ${RUN}` } });
    expect(wh.status).toBe(201);
    const received = await call('POST', `${INV}/warehouses/${wh.body.data.id}/receive`, {
      body: { items: [{ productId: s.part.id, productName: s.part.name, quantity: 10 }] },
    });
    expect(received.status).toBe(201);
    const van = await call('POST', `${INV}/containers`, {
      body: { name: `Van ${RUN}`, technicianId: E2E_TECH.id, technicianName: 'Tess Tech' },
    });
    expect(van.status).toBe(201);
    s.container = van.body.data;
    const moved = await call('POST', `${INV}/transfers`, {
      body: {
        fromType: 'warehouse',
        fromId: wh.body.data.id,
        toType: 'container',
        toId: s.container.id,
        items: [{ productId: s.part.id, productName: s.part.name, quantity: 5 }],
      },
    });
    expect(moved.status).toBe(201);
    const vanStock = async () => {
      const res = await call('GET', `${INV}/containers/${s.container.id}/stock`);
      return res.body.data.find((i: any) => i.productId === s.part.id)?.quantity;
    };
    expect(await vanStock()).toBe(5);

    const d3 = await call('POST', DEAL, { body: dealBody(s.contact2.id) });
    expect(d3.status).toBe(201);
    s.deal3 = d3.body.data;
    const assigned = await call('POST', `${DEAL}/${s.deal3.id}/assign`, { body: { techIds: [E2E_TECH.id] } });
    expect(assigned.status).toBe(201);

    const line = (p: any, quantity: number) => ({
      productId: p.id,
      name: p.name,
      sku: p.sku,
      quantity,
      priceClient: p.priceClient,
      costCompany: p.costCompany,
      costForTech: p.costTech,
    });
    // No productType on the lines: deal-service looks the type up in inventory.
    const ea = (await call('POST', `${BILL}/estimates`, { body: { dealId: s.deal3.id } })).body.data;
    await call('POST', `${BILL}/estimates/${ea.id}/items`, { body: line(s.part, 3) });
    await call('POST', `${BILL}/estimates/${ea.id}/items`, { body: line(s.service, 1) });
    const syncA = await call('POST', `${BILL}/estimates/${ea.id}/sync-to-job`);
    expect(syncA.status).toBe(200);
    let jobItems = (await call('GET', `${DEAL}/${s.deal3.id}/products`)).body.data;
    const byId = (rows: any[]) => new Map<string, any>(rows.map((i: any) => [i.productId, i]));
    expect(byId(jobItems).get(s.part.id)).toMatchObject({ fulfillment: 'sourced', sourceTechId: E2E_TECH.id, quantity: 3 });
    expect(byId(jobItems).get(s.service.id)).toMatchObject({ fulfillment: 'service' });
    expect(await vanStock()).toBe(2);

    // Re-sync: the 3 go back to the van, 1 comes out again; the service line is dropped.
    const eb = (await call('POST', `${BILL}/estimates`, { body: { dealId: s.deal3.id } })).body.data;
    await call('POST', `${BILL}/estimates/${eb.id}/items`, { body: line(s.part, 1) });
    expect((await call('POST', `${BILL}/estimates/${eb.id}/sync-to-job`)).status).toBe(200);
    jobItems = (await call('GET', `${DEAL}/${s.deal3.id}/products`)).body.data;
    expect(jobItems).toHaveLength(1);
    expect(jobItems[0]).toMatchObject({ productId: s.part.id, fulfillment: 'sourced', quantity: 1 });
    expect(await vanStock()).toBe(4);

    // More than the van holds → to_order, and nothing is deducted.
    const ec = (await call('POST', `${BILL}/estimates`, { body: { dealId: s.deal3.id } })).body.data;
    await call('POST', `${BILL}/estimates/${ec.id}/items`, { body: line(s.part, 50) });
    expect((await call('POST', `${BILL}/estimates/${ec.id}/sync-to-job`)).status).toBe(200);
    jobItems = (await call('GET', `${DEAL}/${s.deal3.id}/products`)).body.data;
    expect(jobItems).toEqual([expect.objectContaining({ productId: s.part.id, fulfillment: 'to_order', quantity: 50 })]);
    expect(await vanStock()).toBe(5);

    // A job line is at least 1: an estimate line that could never sync is refused up front.
    const frac = await call('POST', `${BILL}/estimates/${ec.id}/items`, { body: line(s.service, 0.5) });
    expect(frac.status).toBe(400);

    // The technician only sees documents of jobs they are assigned to.
    const techSummary = await call('GET', `${BILL}/estimates/summary`, { auth: TECH_AUTH });
    expect(techSummary.status).toBe(200);
    expect(techSummary.body.data.total.count).toBe(3);
    const techList = await call('GET', `${BILL}/estimates?limit=100`, { auth: TECH_AUTH });
    expect(techList.body.data.items.map((e: any) => e.dealId)).toEqual([s.deal3.id, s.deal3.id, s.deal3.id]);
    expect((await call('GET', `${BILL}/estimates/${ea.id}`, { auth: TECH_AUTH })).status).toBe(200);
    expect((await call('GET', `${BILL}/estimates/${s.e2.id}`, { auth: TECH_AUTH })).status).toBe(403);
    expect((await call('GET', `${BILL}/estimates/by-deal/${s.deal.id}`, { auth: TECH_AUTH })).status).toBe(403);
    expect((await call('POST', `${BILL}/estimates`, { auth: TECH_AUTH, body: { dealId: s.deal.id } })).status).toBe(403);
    // Permission gate (not scope): no templates.edit for a technician.
    expect((await call('POST', `${BILL}/templates`, { auth: TECH_AUTH, body: { name: 'x', kind: 'invoice' } })).status).toBe(403);

    const inv3 = await call('POST', `${BILL}/invoices`, { auth: TECH_AUTH, body: { dealId: s.deal3.id } });
    expect(inv3.status).toBe(201);
    const techInvoices = await call('GET', `${BILL}/invoices/summary`, { auth: TECH_AUTH });
    expect(techInvoices.body.data).toMatchObject({ dueCount: 1, unsentCount: 1 });
  });

  it('16. client change moves the documents; filters; unsend; revoke; area-tax edits; job deletion cascades', async () => {
    // deal2 (Bob) gets an invoice; both of Bob's documents are sent.
    const add = await call('POST', `${DEAL}/${s.deal2.id}/products`, {
      body: {
        productId: s.service.id,
        name: s.service.name,
        sku: s.service.sku,
        quantity: 1,
        costCompany: 10,
        costForTech: 12,
        priceClient: 95.5,
        fulfillment: 'service',
      },
    });
    expect(add.status).toBe(201);
    expect((await call('POST', `${BILL}/invoices`, { body: { dealId: s.deal2.id } })).status).toBe(201);
    expect((await call('POST', `${BILL}/invoices/${s.deal2.id}/mark-sent`, { body: { sent: true } })).status).toBe(200);
    const bobLink = (await call('POST', `${BILL}/portal-links/${s.contact2.id}`)).body.data;
    const bobIp = { 'x-forwarded-for': '198.51.100.1' };
    const adaIp = { 'x-forwarded-for': '198.51.100.2' };
    const portal = async (token: string, headers: Record<string, string>) =>
      (await call('GET', `${BILL}/public/portal/${token}`, { auth: false, headers })).body.data;
    let bob = await portal(bobLink.token, bobIp);
    expect(bob.invoices.map((d: any) => d.id)).toEqual([s.deal2.id]);
    expect(bob.estimates.map((d: any) => d.id)).toEqual([s.otherEstimate.id]);
    expect((await call('GET', `${BILL}/portal-links/${s.contact2.id}`)).body.data.lastViewedAt).toEqual(expect.any(String));

    // The job moves to Ada: its invoice AND its estimates follow (deal.updated).
    const moved = await call('PUT', `${DEAL}/${s.deal2.id}/client`, { body: { contactId: s.contact.id } });
    expect(moved.status).toBe(200);
    const ada = await eventually(
      async () => {
        const view = await portal(s.token, adaIp);
        const ids = [...view.invoices, ...view.estimates].map((d: any) => d.id);
        return ids.includes(s.deal2.id) && ids.includes(s.otherEstimate.id) ? view : null;
      },
      { label: "job documents following the job to its new client" },
    );
    expect(ada.estimates.map((d: any) => d.id)).toEqual(expect.arrayContaining([s.e3.id, s.otherEstimate.id]));
    bob = await portal(bobLink.token, bobIp);
    expect(bob.invoices).toEqual([]);
    expect(bob.estimates).toEqual([]);
    expect((await call('GET', `${BILL}/public/portal/${bobLink.token}/estimate/${s.otherEstimate.id}/pdf`, { auth: false, headers: bobIp })).status).toBe(404);
    expect((await call('GET', `${BILL}/estimates?contactId=${s.contact2.id}`)).body.data.items.map((e: any) => e.id)).not.toContain(s.otherEstimate.id);

    // Invoice list filters.
    const ids = async (qs: string) =>
      (await call('GET', `${BILL}/invoices?${qs}`)).body.data.items.map((i: any) => i.id).sort();
    expect(await ids(`contactId=${s.contact.id}`)).toEqual([s.deal2.id]);
    expect(await ids('status=due')).toEqual([s.deal2.id, s.deal3.id].sort());
    expect(await ids('unsent=true')).toEqual([s.deal3.id]);
    expect(await ids(`dealId=${s.deal3.id}`)).toEqual([s.deal3.id]);
    const today = new Date().toISOString().slice(0, 10);
    expect(await ids(`from=${today}&to=${today}`)).toEqual([s.deal2.id, s.deal3.id].sort());
    expect(await ids('from=2000-01-01&to=2000-01-02')).toEqual([]);
    const page1 = await call('GET', `${BILL}/invoices?limit=1`);
    expect(page1.body.data.items).toHaveLength(1);
    const page2 = await call('GET', `${BILL}/invoices?limit=1&cursor=${encodeURIComponent(page1.body.data.nextCursor)}`);
    expect(page2.body.data.items).toHaveLength(1);
    expect(page2.body.data.items[0].id).not.toBe(page1.body.data.items[0].id);
    expect((await call('GET', `${BILL}/invoices?status=bogus`)).status).toBe(400);

    // Unsend hides it from the portal again.
    const unsent = await call('POST', `${BILL}/invoices/${s.deal2.id}/mark-sent`, { body: { sent: false } });
    expect(unsent.body.data.sentAt).toBeUndefined();
    expect(await ids('unsent=true')).toEqual([s.deal2.id, s.deal3.id].sort());
    expect((await portal(s.token, adaIp)).invoices).toEqual([]);

    // Invoice edits.
    const notes = await call('PATCH', `${BILL}/invoices/${s.deal2.id}`, {
      body: { notes: 'Thanks!', templateId: s.template.id, dueDate: '2030-01-31' },
    });
    expect(notes.status).toBe(200);
    expect(notes.body.data).toMatchObject({ notes: 'Thanks!', templateId: s.template.id, dueDate: '2030-01-31' });
    const cleared = await call('PATCH', `${BILL}/invoices/${s.deal2.id}`, { body: { notes: null, templateId: null } });
    expect(cleared.body.data.notes).toBeUndefined();
    expect(cleared.body.data.templateId).toBeUndefined();
    expect((await call('PATCH', `${BILL}/invoices/${s.deal2.id}`, { body: { dueDate: '31/01/2030' } })).status).toBe(400);
    const internal = await call('GET', `${BILL}/invoices/internal/${s.deal2.id}`, {
      auth: false,
      headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET! },
    });
    expect(internal.status).toBe(200);
    expect(internal.body.data.items).toBeUndefined();

    // Estimate filters, paging, edits, delete.
    const archived = await call('GET', `${BILL}/estimates?dealId=${s.deal.id}&status=archived`);
    expect(archived.body.data.items.map((e: any) => e.id).sort()).toEqual([s.e1.id, s.e3.id, s.e4.id].sort());
    const ep1 = await call('GET', `${BILL}/estimates?dealId=${s.deal.id}&limit=2`);
    const ep2 = await call('GET', `${BILL}/estimates?dealId=${s.deal.id}&limit=2&cursor=${encodeURIComponent(ep1.body.data.nextCursor)}`);
    expect([...ep1.body.data.items, ...ep2.body.data.items].map((e: any) => e.id).sort()).toEqual(
      [s.e1.id, s.e2.id, s.e3.id, s.e4.id].sort(),
    );
    const noTax = await call('PATCH', `${BILL}/estimates/${s.e1.id}`, { body: { taxRateId: null, name: '  Plan A ' } });
    expect(noTax.status).toBe(200);
    expect(noTax.body.data).toMatchObject({ taxRatePercent: 0, taxSource: 'manual', name: 'Plan A' });
    expect(noTax.body.data.taxRateId).toBeUndefined();
    expect((await call('PATCH', `${BILL}/estimates/${s.e1.id}`, { body: { taxRateId: 'nope' } })).status).toBe(404);
    expect((await call('DELETE', `${BILL}/estimates/${s.e4.id}`)).status).toBe(200);
    expect((await call('GET', `${BILL}/estimates/${s.e4.id}`)).status).toBe(404);
    // An archived estimate cannot be synced.
    expect((await call('POST', `${BILL}/estimates/${s.e1.id}/sync-to-job`)).status).toBe(422);

    // Area taxes: editing one changes the derived rate but never re-prices a job;
    // clearing one removes the rate.
    const upA = await call('PUT', `${DEAL}/service-areas/${s.areaA}`, {
      body: { tax: { name: `State tax ${RUN}`, ratePercent: 7 } },
    });
    expect(upA.status).toBe(200);
    const rates = (await call('GET', `${DEAL}/internal/tax-rates`, {
      auth: false,
      headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET! },
    })).body.data;
    expect(rates.find((r: any) => r.id === s.areaA).ratePercent).toBe(7);
    expect((await call('GET', `${DEAL}/${s.deal.id}`)).body.data).toMatchObject({ taxRateId: s.areaA, taxRatePercent: 6.35 });
    const noG = await call('PUT', `${DEAL}/service-areas/${s.areaG}`, { body: { tax: null } });
    expect(noG.status).toBe(200);
    expect(noG.body.data.tax).toBeUndefined();
    expect((await call('GET', `${DEAL}/tax-rates/${s.areaG}`)).status).toBe(404);
    expect((await call('PATCH', `${BILL}/estimates/${s.e2.id}`, { body: { taxRateId: s.areaG } })).status).toBe(404);

    // Revoking the link.
    expect((await call('DELETE', `${BILL}/portal-links/${s.contact.id}`)).status).toBe(200);
    expect((await call('GET', `${BILL}/portal-links/${s.contact.id}`)).body.data).toBeNull();
    expect((await call('GET', `${BILL}/public/portal/${s.token}`, { auth: false, headers: adaIp })).status).toBe(404);
    expect((await call('DELETE', `${BILL}/portal-links/${s.contact.id}`)).status).toBe(404);

    // Deleting the job takes its invoice and estimates with it (deal.deleted).
    expect((await call('DELETE', `${DEAL}/${s.deal2.id}`)).status).toBe(200);
    await eventually(
      async () => {
        const [inv, est] = await Promise.all([
          call('GET', `${BILL}/invoices/internal/${s.deal2.id}`, {
            auth: false,
            headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET! },
          }),
          call('GET', `${BILL}/estimates/${s.otherEstimate.id}`),
        ]);
        return inv.status === 404 && est.status === 404;
      },
      { label: 'invoice + estimates removed after deal.deleted' },
    );
    const summary = await call('GET', `${BILL}/invoices/summary`);
    expect(summary.body.data).toMatchObject({ dueCount: 1, unsentCount: 1 });
  });
  it('17. company client: exempt company → exempt job; company terms drive the invoice due date', async () => {
    const co = await call('POST', `${CRM}/companies`, {
      body: { title: `Acme ${RUN}`, clientType: 'commercial', taxExempt: true, paymentTerms: 'net60' },
    });
    expect(co.status).toBe(201);
    const rep = await call('POST', `${CRM}/contacts`, {
      body: {
        firstName: 'Cy',
        lastName: `Rep${RUN}`,
        phones: [phone(3)],
        type: 'company_representative',
        source: 'manual',
        companyId: co.body.data.id,
      },
    });
    expect(rep.status).toBe(201);
    expect(rep.body.data.taxExempt ?? false).toBe(false);

    const d = await call('POST', DEAL, {
      body: { ...dealBody(rep.body.data.id), clientType: 'commercial', companyId: co.body.data.id },
    });
    expect(d.status).toBe(201);
    expect(d.body.data.taxSource).toBe('exempt');
    expect(d.body.data.taxRateId).toBeUndefined();

    const add = await call('POST', `${DEAL}/${d.body.data.id}/products`, {
      body: {
        productId: s.service.id,
        name: s.service.name,
        sku: s.service.sku,
        quantity: 2,
        costCompany: 10,
        costForTech: 12,
        priceClient: 95.5,
        fulfillment: 'service',
      },
    });
    expect(add.status).toBe(201);
    const inv = await call('POST', `${BILL}/invoices`, { body: { dealId: d.body.data.id } });
    expect(inv.status).toBe(201);
    const due = new Date(Date.parse(`${inv.body.data.invoiceDate}T00:00:00Z`) + 60 * 86_400_000).toISOString().slice(0, 10);
    expect(inv.body.data).toMatchObject({
      companyId: co.body.data.id,
      paymentTerms: 'net60',
      dueDate: due,
      taxSource: 'exempt',
      totals: totalsOf([{ productId: s.service.id, quantity: 2, priceClient: 95.5 }], 0),
    });
    const html = await call('GET', `${BILL}/invoices/${d.body.data.id}/html`);
    expect(html.body.data.html).toContain('Net 60');

    // A payment recorded on the job (payment.received → deal.updated) marks the invoice paid.
    const total = inv.body.data.totals.total;
    const paid = await call('PUT', `${DEAL}/internal/${d.body.data.id}/payment-status`, {
      auth: false,
      headers: { 'x-internal-secret': process.env.INTERNAL_SERVICE_SECRET! },
      body: { paymentId: `pay-${RUN}`, amount: total, paidAt: new Date().toISOString() },
    });
    expect(paid.status).toBe(200);
    await eventually(
      async () => {
        const list = await call('GET', `${BILL}/invoices?status=paid`);
        return list.body.data.items.some((i: any) => i.id === d.body.data.id);
      },
      { label: 'invoice snapshot paid after the job payment' },
    );
    const summary = await call('GET', `${BILL}/invoices/summary`);
    expect(summary.body.data).toMatchObject({ paidCount: 1, paidAmount: total });
    const view = await call('GET', `${BILL}/invoices/${d.body.data.id}`);
    expect(view.body.data).toMatchObject({ status: 'paid' });
    expect(view.body.data.totals).toMatchObject({ amountPaid: total, balanceDue: 0 });
    expect((await call('GET', `${DEAL}/${d.body.data.id}/totals`)).body.data).toEqual(view.body.data.totals);
  });
});
