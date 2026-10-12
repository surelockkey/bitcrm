/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { HttpException, HttpStatus, NotFoundException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { HttpExceptionFilter, signClientConfirmToken } from '@bitcrm/shared';
import type { ClientConfirmJob } from '@bitcrm/types';
import { BusinessProfileService } from 'src/business-profile/business-profile.service';
import { DealClient } from 'src/integrations/deal.client';
import { ClientConfirmPageService } from 'src/portal/client-confirm-page.service';
import { PortalRateLimiter } from 'src/portal/portal-rate-limiter';
import { PublicClientConfirmController } from 'src/portal/public-client-confirm.controller';

/**
 * The client's "confirm your appointment" page (B12, Workiz {{confirm_link}}):
 * `/api/billing/public/confirm/<token>`, public and rate limited. The token is
 * the job's own signed link (`@bitcrm/shared`); deal-service decides and records.
 */
const DEAL = '3f2b8c1e-9d4a-4b7e-8f21-0c5d6e7f8a9b';
const SECRET = 'confirm-test-secret';

const job = (over: Partial<ClientConfirmJob> = {}): ClientConfirmJob => ({
  dealId: DEAL,
  dealNumber: 'K4T9ZW',
  state: 'open',
  scheduledDate: '2026-10-14',
  scheduledTimeSlot: '09:00-11:00',
  timezone: 'America/New_York',
  address: { street: '12 Main St', unit: 'Apt 3', city: 'Stamford', state: 'CT', zip: '06901' },
  jobType: 'Lockout',
  businessProfileId: 'bp-2',
  ...over,
});

const BUSINESS = { name: 'Sure Lock & Key', phone: '(203) 403-6303', logoUrl: 'https://cdn.example.com/logo.png' };

describe('client confirm page — public routes (HTTP)', () => {
  let app: INestApplication;
  const deals = { getClientConfirm: jest.fn(), confirmByClient: jest.fn() };
  const profiles = { getPublic: jest.fn() };
  const limiter = { check: jest.fn(), checkWrite: jest.fn() };
  let token: string;

  beforeAll(async () => {
    process.env.PORTAL_TOKEN_SECRET = SECRET;
    token = signClientConfirmToken(DEAL, SECRET)!;
    const mod = await Test.createTestingModule({
      controllers: [PublicClientConfirmController],
      providers: [
        ClientConfirmPageService,
        { provide: DealClient, useValue: deals },
        { provide: BusinessProfileService, useValue: profiles },
        { provide: PortalRateLimiter, useValue: limiter },
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/billing');
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    delete process.env.PORTAL_TOKEN_SECRET;
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    limiter.check.mockResolvedValue(undefined);
    profiles.getPublic.mockResolvedValue(BUSINESS);
  });

  it('GET shows the visit, the place and the company the job is done under', async () => {
    deals.getClientConfirm.mockResolvedValue(job());

    const res = await request(app.getHttpServer())
      .get(`/api/billing/public/confirm/${token}`)
      .set('x-forwarded-for', '203.0.113.9');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: {
        state: 'open',
        business: BUSINESS,
        job: {
          number: 'K4T9ZW',
          scheduledDate: '2026-10-14',
          scheduledTimeSlot: '09:00-11:00',
          timezone: 'America/New_York',
          address: '12 Main St, Apt 3, Stamford, CT 06901',
          jobType: 'Lockout',
        },
      },
    });
    expect(deals.getClientConfirm).toHaveBeenCalledWith(DEAL);
    expect(profiles.getPublic).toHaveBeenCalledWith('bp-2');
    expect(limiter.check).toHaveBeenCalledWith('203.0.113.9', token);
    // Nothing of ours leaks: no deal id, no company id.
    expect(JSON.stringify(res.body)).not.toContain(DEAL);
    expect(JSON.stringify(res.body)).not.toContain('bp-2');
  });

  it('POST confirms with how the client came, and answers the thank-you state', async () => {
    deals.confirmByClient.mockResolvedValue(
      job({ state: 'confirmed', confirmedAt: '2026-10-12T15:00:00.000Z', recorded: true }),
    );

    const res = await request(app.getHttpServer())
      .post(`/api/billing/public/confirm/${token}`)
      .set('x-forwarded-for', '203.0.113.9')
      .set('user-agent', 'Mozilla/5.0 (iPhone)')
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ state: 'confirmed', confirmedAt: '2026-10-12T15:00:00.000Z' });
    expect(res.body.data).not.toHaveProperty('recorded');
    expect(deals.confirmByClient).toHaveBeenCalledWith(DEAL, {
      via: 'link',
      ip: '203.0.113.9',
      userAgent: 'Mozilla/5.0 (iPhone)',
    });
  });

  it('a closed or expired job is an answer, not an error — the page explains it', async () => {
    deals.confirmByClient.mockResolvedValue(job({ state: 'closed', recorded: false }));
    const res = await request(app.getHttpServer()).post(`/api/billing/public/confirm/${token}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('closed');
  });

  it('404s a forged, malformed or foreign token without asking deal-service', async () => {
    const forged = signClientConfirmToken(DEAL, 'another-secret')!;
    for (const bad of [forged, 'nope', `${token}x`]) {
      const res = await request(app.getHttpServer()).get(`/api/billing/public/confirm/${bad}`);
      expect(res.status).toBe(404);
      expect(res.body.error.message).toBe('This link is no longer valid');
    }
    expect(deals.getClientConfirm).not.toHaveBeenCalled();
  });

  it('404s a job that is gone', async () => {
    deals.getClientConfirm.mockResolvedValue(null);
    const res = await request(app.getHttpServer()).get(`/api/billing/public/confirm/${token}`);
    expect(res.status).toBe(404);
  });

  it('is rate limited per address and link, before anything is read', async () => {
    limiter.check.mockRejectedValue(new HttpException('Too many requests — try again in a minute', HttpStatus.TOO_MANY_REQUESTS));
    const res = await request(app.getHttpServer()).post(`/api/billing/public/confirm/${token}`).send({});
    expect(res.status).toBe(429);
    expect(deals.confirmByClient).not.toHaveBeenCalled();
  });

  it('a deal-service 404 stays a 404 for the client', async () => {
    deals.confirmByClient.mockRejectedValue(new NotFoundException('Deal not found'));
    const res = await request(app.getHttpServer()).post(`/api/billing/public/confirm/${token}`).send({});
    expect(res.status).toBe(404);
    expect(res.body.error.message).toBe('This link is no longer valid');
  });
});

describe('DealClient — the job half of the confirm page', () => {
  function fake(status = 200, data: unknown = job()) {
    const calls: Array<{ url: string; init: any }> = [];
    const fetchImpl = jest.fn(async (url: string, init?: any) => {
      calls.push({ url, init });
      return { ok: status < 400, status, json: async () => ({ success: status < 400, data }) };
    });
    return { client: new DealClient(fetchImpl as any), calls };
  }

  it('reads and confirms through the internal routes with the internal secret', async () => {
    const { client, calls } = fake();
    await client.getClientConfirm(DEAL);
    await client.confirmByClient(DEAL, { via: 'link', ip: '203.0.113.9' });
    expect(calls[0].url).toMatch(new RegExp(`/api/deals/internal/${DEAL}/client-confirm$`));
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers).toHaveProperty('x-internal-secret');
    expect(calls[1].url).toMatch(new RegExp(`/api/deals/internal/${DEAL}/client-confirm$`));
    expect(calls[1].init.method).toBe('POST');
    expect(JSON.parse(calls[1].init.body)).toEqual({ via: 'link', ip: '203.0.113.9' });
  });

  it('answers null for a job deal-service does not have', async () => {
    const { client } = fake(404, null);
    await expect(client.getClientConfirm(DEAL)).resolves.toBeNull();
    await expect(client.confirmByClient(DEAL, { via: 'link' })).resolves.toBeNull();
  });
});
