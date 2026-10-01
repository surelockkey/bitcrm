/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { CrmClient } from 'src/integrations/crm.client';
import { DealClient } from 'src/integrations/deal.client';
import { UserClient } from 'src/integrations/user.client';
import { PaymentsController } from 'src/payments/payments.controller';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentReportController } from 'src/payments/report/payment-report.controller';
import { PaymentReportProjector } from 'src/payments/report/payment-report.projector';
import { PaymentReportRepository } from 'src/payments/report/payment-report.repository';
import { PaymentReportService } from 'src/payments/report/payment-report.service';
import { mockDealClient, perms, user } from './mocks';
import { payment } from './payment-mocks';
import { FakeReportRepo } from './payment-report.fakes';

/**
 * The query as the real app parses it (ValidationPipe transform + whitelist,
 * as main.ts sets it): comma lists and repeated params become arrays, a bad
 * date or an oversized page is a 400, and the static `/payments/report`
 * paths live beside the ledger's `/payments` routes.
 */
describe('Payments report (HTTP)', () => {
  let app: INestApplication;
  let service: PaymentReportService;
  const ledgerList = jest.fn(async () => ({ items: [] }));

  beforeAll(async () => {
    const repo = new FakeReportRepo();
    const deal = mockDealClient();
    const projector = new PaymentReportProjector(repo as any, deal as any);
    for (const p of [
      payment({ id: 'p1', amount: 100, tipAmount: 10, stripePaymentIntentId: 'pi', takenAt: '2026-09-03T15:00:00.000Z' }),
      payment({ id: 'p2', method: 'cash', source: 'office', takenBy: 'u', amount: 50, takenAt: '2026-09-04T15:00:00.000Z' }),
    ]) {
      repo.putPayment(p);
      await projector.projectOrThrow(p.id);
    }

    const mod = await Test.createTestingModule({
      controllers: [PaymentReportController, PaymentsController],
      providers: [
        {
          provide: APP_GUARD,
          useValue: {
            canActivate: (ctx: any) => {
              const req = ctx.switchToHttp().getRequest();
              req.user = user();
              req.resolvedPermissions = perms();
              return true;
            },
          },
        },
        { provide: PaymentReportRepository, useValue: repo },
        { provide: DealClient, useValue: { ...deal, getDealsByIds: jest.fn(async () => []), listJobTypes: jest.fn(async () => []) } },
        { provide: CrmClient, useValue: { contactNamesByIds: jest.fn(async () => []) } },
        { provide: UserClient, useValue: { namesByIds: jest.fn(async () => []) } },
        { provide: PaymentsService, useValue: { list: ledgerList } },
        PaymentReportService,
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/billing');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    service = app.get(PaymentReportService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('answers a page with the whole range’s totals', async () => {
    const res = await request(app.getHttpServer()).get('/api/billing/payments/report?from=2026-09-01&to=2026-09-30&limit=5');
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((r: any) => r.id)).toEqual(['p2', 'p1']);
    expect(res.body.data.totals).toMatchObject({ count: 2, amount: 160, tips: 10 });
  });

  it('reads comma lists and repeated params as arrays', async () => {
    const spy = jest.spyOn(service, 'totals');
    await request(app.getHttpServer()).get('/api/billing/payments/report/totals?types=charge,cash&technicianIds=t1&technicianIds=t2');
    expect(spy.mock.calls[0][0]).toMatchObject({ types: ['charge', 'cash'], technicianIds: ['t1', 't2'] });
    const res = await request(app.getHttpServer()).get('/api/billing/payments/report/totals?from=2026-09-01&to=2026-09-30&types=cash');
    expect(res.body.data).toMatchObject({ count: 1, amount: 50 });
  });

  it('400s a date it cannot read and a page over 100', async () => {
    expect((await request(app.getHttpServer()).get('/api/billing/payments/report?from=09/01/2026')).status).toBe(400);
    expect((await request(app.getHttpServer()).get('/api/billing/payments/report?limit=500')).status).toBe(400);
    expect((await request(app.getHttpServer()).get('/api/billing/payments/report?dir=sideways')).status).toBe(400);
  });

  it('exports CSV inside the envelope', async () => {
    const res = await request(app.getHttpServer()).get('/api/billing/payments/report/export?from=2026-09-01&to=2026-09-30');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ filename: 'Payment report.csv', count: 2, truncated: false });
    expect(res.body.data.csv.split('\n')[0]).toMatch(/^Job ID,Document,Payment type,Status,Amount,Service Fee,Net,Tips/);
  });

  it('leaves the ledger’s own GET /payments where it was', async () => {
    const res = await request(app.getHttpServer()).get('/api/billing/payments?limit=5');
    expect(res.status).toBe(200);
    expect(ledgerList).toHaveBeenCalled();
  });
});
