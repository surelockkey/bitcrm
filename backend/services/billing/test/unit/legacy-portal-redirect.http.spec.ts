import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { APP_GUARD } from '@nestjs/core';
import { LegacyPortalRedirectController } from 'src/portal/public-portal.controller';

/**
 * The route lives OUTSIDE the `api/billing` global prefix (main.ts excludes it), which is
 * the part a plain controller call cannot prove: an old `<api host>/portal/<token>` link has
 * to answer 302 at exactly that path, and only there.
 */
describe('legacy portal link redirect (HTTP)', () => {
  let app: INestApplication;
  const token = 'A'.repeat(43);

  beforeAll(async () => {
    process.env.PORTAL_BASE_URL = 'https://portal.example.com/';
    const mod = await Test.createTestingModule({
      controllers: [LegacyPortalRedirectController],
      // The real app guards everything with Cognito; @Public() steps aside, so no guard is needed here.
      providers: [{ provide: APP_GUARD, useValue: { canActivate: () => true } }],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/billing', { exclude: ['portal/:token'] });
    await app.init();
  });
  afterAll(async () => {
    delete process.env.PORTAL_BASE_URL;
    await app.close();
  });

  it('302s /portal/<token> to the portal domain', async () => {
    const res = await request(app.getHttpServer()).get(`/portal/${token}`).redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://portal.example.com/${token}`);
  });

  it('is not also served under the service prefix', async () => {
    const res = await request(app.getHttpServer()).get(`/api/billing/portal/${token}`).redirects(0);
    expect(res.status).toBe(404);
  });

  it('404s something that cannot be a token', async () => {
    const res = await request(app.getHttpServer()).get('/portal/nope').redirects(0);
    expect(res.status).toBe(404);
  });
});
