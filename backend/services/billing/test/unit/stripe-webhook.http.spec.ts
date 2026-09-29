/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import Stripe from 'stripe';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { StripeWebhookController } from 'src/payments/stripe/stripe-webhook.controller';
import { StripeEventsHandler } from 'src/payments/stripe/stripe-events.handler';
import { STRIPE_CLIENT, createStripeClient } from 'src/payments/stripe/stripe.module';
import { StripeService } from 'src/payments/stripe/stripe.service';
import { PaymentsRepository } from 'src/payments/payments.repository';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { InvoicesService } from 'src/invoices/invoices.service';
import { DealClient } from 'src/integrations/deal.client';
import { BillingEventsPublisher } from 'src/integrations/billing-events.publisher';
import { mockDealClient, mockEvents } from './mocks';
import { fakeInvoices, fakeLedger, invoice, payment } from './payment-mocks';

const SECRET = 'whsec_test_secret_for_specs';
const stripe = new Stripe('sk_test_dummy_key_for_specs', { apiVersion: '2026-08-26.dahlia' });
const sign = (payload: string, timestamp?: number) =>
  stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET, ...(timestamp && { timestamp }) });

/**
 * The integration this file exists to protect: Stripe signs the EXACT bytes of
 * the request, so the verification only passes if `req.rawBody` survived the
 * body parser. billing's `main.ts` replaces that parser (a 4 MB JSON limit for
 * template saves), which is precisely where rawBody usually gets lost — and a
 * `MiddlewareConsumer` cannot recover it, because Nest middleware runs after
 * the parsers. So this boots a real Nest app configured exactly as `main.ts`
 * does and posts really-signed bytes through it.
 */
describe('POST /api/billing/webhooks/stripe (raw body, real signature)', () => {
  let app: NestExpressApplication;
  let ledger: ReturnType<typeof fakeLedger>;
  let handler: StripeEventsHandler;

  const body = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      id: 'evt_http_1',
      object: 'event',
      api_version: '2026-08-26.dahlia',
      created: Math.floor(Date.now() / 1000),
      livemode: false,
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_1',
          object: 'payment_intent',
          status: 'succeeded',
          amount: 10_000,
          currency: 'usd',
          metadata: { paymentId: 'p1', invoiceId: 'deal-1', dealId: 'deal-1', contactId: 'contact-1' },
        },
      },
      ...over,
    });

  beforeAll(async () => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    ledger = fakeLedger([payment({ id: 'p1', status: 'pending', amount: 100, stripeSessionId: 'cs_1' })]);
    const invoices = fakeInvoices(invoice(), ledger);

    const mod = await Test.createTestingModule({
      controllers: [StripeWebhookController],
      providers: [
        { provide: APP_GUARD, useValue: { canActivate: () => true } },
        { provide: STRIPE_CLIENT, useValue: createStripeClient('sk_test_dummy_key_for_specs') },
        StripeService,
        { provide: PaymentsRepository, useValue: ledger },
        { provide: InvoicesService, useValue: invoices },
        { provide: DealClient, useValue: mockDealClient() },
        { provide: BillingEventsPublisher, useValue: mockEvents() },
        PaymentSettingsService,
        PaymentsService,
        StripeEventsHandler,
      ],
    }).compile();

    // Exactly what src/main.ts does — if that changes, this fails.
    app = mod.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.useBodyParser('json', { limit: '4mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '1mb' });
    app.setGlobalPrefix('api/billing', { exclude: ['portal/:token'] });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    handler = app.get(StripeEventsHandler);
  });

  afterAll(async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    await app.close();
  });

  const post = (payload: string, header?: string) => {
    const req = request(app.getHttpServer())
      .post('/api/billing/webhooks/stripe')
      .set('content-type', 'application/json');
    if (header !== undefined) req.set('stripe-signature', header);
    return req.send(payload);
  };

  it('accepts a correctly signed body and processes the event', async () => {
    const payload = body();
    const res = await post(payload, sign(payload));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, duplicate: false });
    await handler.settle();
    expect(ledger.payments.get('p1')!.status).toBe('settled');
  });

  it('answers 200 to a replay of the same event without a second effect', async () => {
    const payload = body({ id: 'evt_http_replay' });
    const first = await post(payload, sign(payload));
    expect(first.body.duplicate).toBe(false);
    await handler.settle();
    const version = ledger.payments.get('p1')!.version;

    const second = await post(payload, sign(payload));
    expect(second.status).toBe(200);
    expect(second.body.duplicate).toBe(true);
    await handler.settle();
    expect(ledger.payments.get('p1')!.version).toBe(version);
  });

  it('400s a body signed with the wrong secret', async () => {
    const payload = body({ id: 'evt_http_2' });
    const wrong = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_not_ours' });
    const res = await post(payload, wrong);
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/signature/i);
  });

  it('400s a signature over DIFFERENT bytes — proving the raw body reached us intact', async () => {
    const signed = body({ id: 'evt_http_3' });
    const tampered = body({ id: 'evt_http_3', livemode: true });
    const res = await post(tampered, sign(signed));
    expect(res.status).toBe(400);
  });

  it('400s a timestamp outside the tolerance (a replayed capture)', async () => {
    const payload = body({ id: 'evt_http_4' });
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;
    const res = await post(payload, sign(payload, stale));
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toMatch(/timestamp|tolerance/i);
  });

  it('400s a missing signature header, and an empty body', async () => {
    const payload = body({ id: 'evt_http_5' });
    expect((await post(payload)).status).toBe(400);
    expect((await post('', sign(''))).status).toBe(400);
  });

  it('verifies bytes the JSON parser would otherwise have rewritten', async () => {
    // Unicode, odd spacing and key order: re-serialising any of it breaks the
    // signature, so a 200 here is proof the ORIGINAL bytes were verified.
    const payload =
      '{"id":"evt_http_6",  "object":"event","api_version":"2026-08-26.dahlia","created":' +
      Math.floor(Date.now() / 1000) +
      ',"livemode":false,"type":"payment_intent.processing","data":{"object":{"id":"pi_1",' +
      '"object":"payment_intent","status":"processing","currency":"usd","description":"Facture — café ☕",' +
      '"metadata":{"paymentId":"p1"}}}}';
    const res = await post(payload, sign(payload));
    expect(res.status).toBe(200);
  });

  it('accepts a body far larger than the default 100kb parser limit', async () => {
    const big = 'x'.repeat(300_000);
    const payload = body({ id: 'evt_http_7', request: { id: big, idempotency_key: null } });
    expect(payload.length).toBeGreaterThan(300_000);
    const res = await post(payload, sign(payload));
    expect(res.status).toBe(200);
  });
});
