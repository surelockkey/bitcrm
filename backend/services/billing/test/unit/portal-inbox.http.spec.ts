import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { PermissionCacheReader } from '@bitcrm/shared';
import { PublicPortalController } from 'src/portal/public-portal.controller';
import { PortalLinksController } from 'src/portal/portal-links.controller';
import { PortalService } from 'src/portal/portal.service';
import { PortalRateLimiter } from 'src/portal/portal-rate-limiter';

/**
 * The paged inbox at the HTTP edge: `:token/inbox` must reach the inbox (not
 * be read as a document route), the query reaches the service as given, and
 * every page is rate limited like the portal itself.
 */
describe('portal inbox pages (HTTP)', () => {
  let app: INestApplication;
  const token = 'A'.repeat(43);
  const portal = {
    publicView: jest.fn(async () => ({ invoices: [], inbox: { total: 0 } })),
    publicInbox: jest.fn(async () => ({ invoices: [], estimates: [], proposals: [], inbox: { total: 0 } })),
    preview: jest.fn(async () => ({ invoices: [], inbox: { total: 0 } })),
    previewInbox: jest.fn(async () => ({ invoices: [], estimates: [], proposals: [], inbox: { total: 0 } })),
  };
  const limiter = { check: jest.fn(async () => undefined), checkWrite: jest.fn(async () => undefined) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [PublicPortalController, PortalLinksController],
      providers: [
        { provide: PortalService, useValue: portal },
        { provide: PortalRateLimiter, useValue: limiter },
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
        // Route guards are not under test here; their reader only has to exist.
        { provide: PermissionCacheReader, useValue: {} },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/billing');
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => jest.clearAllMocks());

  it('GET /public/portal/:token passes limit and show on to the first page', async () => {
    const res = await request(app.getHttpServer()).get(`/api/billing/public/portal/${token}?limit=30&show=invoices,unpaid`);
    expect(res.status).toBe(200);
    expect(portal.publicView).toHaveBeenCalledWith(token, { limit: '30', show: 'invoices,unpaid' });
  });

  it('GET /public/portal/:token/inbox is one more page, rate limited', async () => {
    const res = await request(app.getHttpServer()).get(`/api/billing/public/portal/${token}/inbox?cursor=abc&show=estimates`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: { invoices: [], estimates: [], proposals: [], inbox: { total: 0 } } });
    expect(portal.publicInbox).toHaveBeenCalledWith(token, { cursor: 'abc', show: 'estimates' });
    expect(limiter.check).toHaveBeenCalledTimes(1);
  });

  it('the staff preview takes the same query, and has its own inbox route', async () => {
    await request(app.getHttpServer()).get('/api/billing/portal-links/c1/preview?limit=20').expect(200);
    expect(portal.preview).toHaveBeenCalledWith('c1', { limit: '20' });
    await request(app.getHttpServer()).get('/api/billing/portal-links/c1/preview/inbox?cursor=xyz').expect(200);
    expect(portal.previewInbox).toHaveBeenCalledWith('c1', { cursor: 'xyz' });
  });
});
