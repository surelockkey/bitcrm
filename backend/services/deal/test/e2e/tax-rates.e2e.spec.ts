import { type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ServiceAreaType, type JwtUser } from '@bitcrm/types';
import { setupApp, teardownApp, cleanupData, createTestUserHeader } from './setup';

const BASE = '/api/deals/tax-rates';
const AREAS = '/api/deals/service-areas';

const admin: JwtUser = { id: 'admin-1', cognitoSub: 's1', email: 'a@t.com', roleId: 'role-admin', department: 'HQ' };
const readOnly: JwtUser = { id: 'ro-1', cognitoSub: 's2', email: 'ro@t.com', roleId: 'role-read-only', department: 'HQ' };
const hdr = (u: JwtUser) => ['x-test-user', createTestUserHeader(u)] as const;

const box = (offset: number, extra: Record<string, unknown> = {}) => ({
  name: `Area ${offset}`,
  type: ServiceAreaType.POLYGON,
  vertices: [
    { lat: 33.7 + offset, lng: -84.4 + offset },
    { lat: 33.7 + offset, lng: -84.3 + offset },
    { lat: 33.8 + offset, lng: -84.3 + offset },
    { lat: 33.8 + offset, lng: -84.4 + offset },
  ],
  ...extra,
});

/** Tax rates are derived from service areas (Revision 2) — read-only. */
describe('Tax Rates E2E (derived from service areas)', () => {
  let app: INestApplication;

  beforeAll(async () => { app = await setupApp(); });
  afterAll(async () => teardownApp());
  afterEach(async () => cleanupData());

  const createArea = (body: Record<string, unknown>) =>
    request(app.getHttpServer()).post(AREAS).set(...hdr(admin)).send(body);

  it('exposes one rate per area with a tax (id = area id)', async () => {
    const ct = await createArea(box(0, { name: 'Connecticut', tax: { name: 'CT Sales Tax', ratePercent: 6.35 } })).expect(201);
    await createArea(box(1, { name: 'Untaxed' })).expect(201);

    const list = await request(app.getHttpServer()).get(BASE).set(...hdr(admin)).expect(200);
    expect(list.body.data).toEqual([
      expect.objectContaining({
        id: ct.body.data.id,
        name: 'CT Sales Tax',
        ratePercent: 6.35,
        serviceAreaId: ct.body.data.id,
        serviceAreaName: 'Connecticut',
        isDefault: false,
        isGroup: false,
      }),
    ]);

    const one = await request(app.getHttpServer()).get(`${BASE}/${ct.body.data.id}`).set(...hdr(admin)).expect(200);
    expect(one.body.data.name).toBe('CT Sales Tax');
    await request(app.getHttpServer()).get(`${BASE}/does-not-exist`).set(...hdr(admin)).expect(404);
  });

  it('validates the area tax and clears it on null', async () => {
    await createArea(box(0, { tax: { name: 'Bad', ratePercent: 101 } })).expect(400);
    await createArea(box(0, { tax: { name: 'Bad', ratePercent: 1.2345 } })).expect(400);
    await createArea(box(0, { tax: { name: '', ratePercent: 1 } })).expect(400);

    const area = await createArea(box(0, { tax: { name: 'T', ratePercent: 1 } })).expect(201);
    const cleared = await request(app.getHttpServer())
      .put(`${AREAS}/${area.body.data.id}`).set(...hdr(admin)).send({ tax: null }).expect(200);
    expect(cleared.body.data.tax).toBeUndefined();
    const list = await request(app.getHttpServer()).get(BASE).set(...hdr(admin)).expect(200);
    expect(list.body.data).toEqual([]);
  });

  it('hides archived areas unless includeInactive, and the internal list has them', async () => {
    await createArea(box(0, { active: false, tax: { name: 'Old', ratePercent: 1 } })).expect(201);
    const list = await request(app.getHttpServer()).get(BASE).set(...hdr(admin)).expect(200);
    expect(list.body.data).toHaveLength(0);
    const all = await request(app.getHttpServer()).get(`${BASE}?includeInactive=true`).set(...hdr(admin)).expect(200);
    expect(all.body.data).toHaveLength(1);

    const res = await request(app.getHttpServer())
      .get('/api/deals/internal/tax-rates').set('x-internal-secret', 'test-secret').expect(200);
    expect(res.body.data).toHaveLength(1);
    await request(app.getHttpServer()).get('/api/deals/internal/tax-rates').expect(403);
  });

  it('has no write endpoints any more', async () => {
    await request(app.getHttpServer()).post(BASE).set(...hdr(admin)).send({ name: 'N', ratePercent: 1 }).expect(404);
  });

  it('enforces permissions', async () => {
    await request(app.getHttpServer()).get(BASE).set(...hdr(readOnly)).expect(200);
    await request(app.getHttpServer()).get(BASE).expect(401);
  });
});
