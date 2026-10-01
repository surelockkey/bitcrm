/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import request from 'supertest';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { estimateDepositDue, estimateReportAmount, type Estimate } from '@bitcrm/types';
import { EstimatesController } from 'src/estimates/estimates.controller';
import { EstimatesService } from 'src/estimates/estimates.service';
import { EstimateReportController } from 'src/estimates/report/estimate-report.controller';
import { EstimateReportRepository } from 'src/estimates/report/estimate-report.repository';
import { estimateCards, estimateCsvLine } from 'src/estimates/report/estimate-report.rules';
import { EstimateReportService } from 'src/estimates/report/estimate-report.service';
import { DataScope, caller, perms, user } from './mocks';

const est = (over: Partial<Estimate> = {}): Estimate =>
  ({
    id: 'e-1',
    number: '374494-1',
    dealId: 'd-1',
    dealNumber: 'ZTNRKF',
    contactId: 'c-1',
    status: 'pending',
    estimateDate: '2026-09-02',
    totals: { lineCount: 1, subtotal: 100, taxableSubtotal: 0, nonTaxableSubtotal: 100, discount: 0, taxableBase: 0, taxRatePercent: 0, tax: 0, total: 100, amountPaid: 0, balanceDue: 100 },
    version: 1,
    createdBy: 'u-1',
    createdAt: '2026-09-02T14:00:00.000Z',
    updatedAt: '2026-09-02T14:00:00.000Z',
    ...over,
  }) as Estimate;

describe('Estimates report rules', () => {
  it('prefers Workiz’s own Amount on an imported estimate (unpicked optional items left out)', () => {
    expect(estimateReportAmount(est({ workizTotal: 3968.4 }))).toBe(3968.4);
    expect(estimateReportAmount(est())).toBe(100);
  });

  it('works the deposit out as Workiz does', () => {
    expect(estimateDepositDue(est({ depositAmount: 50, depositPercentage: 30 }))).toBe(50);
    expect(estimateDepositDue(est({ depositPercentage: 33.33, workizTotal: 1000 }))).toBe(333.3);
    expect(estimateDepositDue(est())).toBe(0);
  });

  it('fills all six cards — Declined, Won and Archived too — and their sum, in cents', () => {
    const cards = estimateCards([
      est({ status: 'unsent', workizTotal: 0.1 }),
      est({ status: 'unsent', workizTotal: 0.2 }),
      est({ status: 'won' }),
      est({ status: 'archived', workizTotal: 25 }),
      est({ status: 'declined' }),
    ]);
    expect(cards.unsent).toEqual({ count: 2, amount: 0.3 });
    expect(cards.won).toEqual({ count: 1, amount: 100 });
    expect(cards.archived).toEqual({ count: 1, amount: 25 });
    expect(cards.declined).toEqual({ count: 1, amount: 100 });
    expect(cards.pending).toEqual({ count: 0, amount: 0 });
    expect(cards.total).toEqual({ count: 5, amount: 225.3 });
  });

  it('writes Workiz’s CSV row: Created By, the status as a word, the job’s code', () => {
    const line = estimateCsvLine(est({ name: 'Rekey, all', workizTotal: 1746.34, status: 'won' }), { name: 'Kris Doe', email: 'k@x.com' }, 'Kris Support Manager');
    expect(line).toBe('374494-1,"Rekey, all",Kris Doe,k@x.com,2026-09-02,Kris Support Manager,1746.34,Won,ZTNRKF');
  });
});

describe('EstimateReportRepository', () => {
  it('windows on created New York instants and filters status + search in one expression', () => {
    const repo = new EstimateReportRepository({ client: { send: jest.fn() } } as never);
    const q = repo.buildQuery({ fromIso: '2026-09-01T04:00:00.000Z', toIso: '2026-09-28T04:00:00.000Z', status: 'won', search: 'ztn' });
    expect(q.KeyConditionExpression).toBe('GSI1PK = :pk AND GSI1SK BETWEEN :from AND :to');
    expect(q.ExpressionAttributeValues).toMatchObject({ ':pk': 'ESTIMATES', ':st': 'won', ':qu': 'ZTN' });
    expect(q.FilterExpression).toBe('#st = :st AND (contains(#num, :q) OR contains(#num, :qu) OR contains(#name, :q))');
  });

  it('reads only what the cards need for a window', async () => {
    const send = jest.fn(async () => ({ Items: [{ status: 'won', totals: { total: 5 }, dealId: 'd' }] }));
    const repo = new EstimateReportRepository({ client: { send } } as never);
    await expect(repo.cardRows({})).resolves.toHaveLength(1);
    const input = ((send.mock.calls as any[])[0][0] as QueryCommand).input;
    expect(input.ProjectionExpression).toBe('#p0, #p1, #p2, #p3');
    expect(input.KeyConditionExpression).toBe('GSI1PK = :pk');
  });
});

describe('EstimateReportService', () => {
  function make(rows = [est({ dealId: 'd-1' }), est({ id: 'e-2', dealId: 'd-2', status: 'won', workizTotal: 40 })]) {
    const repo = {
      cardRows: jest.fn(async () => rows),
      page: jest.fn(async () => ({ items: rows })),
      count: jest.fn(async () => ({ total: rows.length, atLeast: false })),
      walk: jest.fn(async () => ({ items: rows, truncated: false })),
    };
    const deal = { listDealIdsByTech: jest.fn(async () => new Set(['d-2'])) };
    const crm = {
      contactsAs: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: 'A', lastName: 'B', emails: ['a@b.c'], phones: [] }))),
      contactNamesByIds: jest.fn(async () => []),
    };
    const users = { namesByIds: jest.fn(async () => [{ id: 'u-1', firstName: 'Dana', lastName: 'Office' }]) };
    const store = new Map<string, string>();
    const redis = { client: { get: jest.fn(async (k: string) => store.get(k) ?? null), set: jest.fn(async (k: string, v: string) => void store.set(k, v)) } };
    const service = new EstimateReportService(repo as any, deal as any, crm as any, users as any, redis as any);
    return { service, repo, redis, users };
  }

  it('answers the cards for the window, cached per window', async () => {
    const { service, repo } = make();
    const s = await service.summary({ from: '2026-09-01', to: '2026-09-27' }, caller());
    expect(s).toMatchObject({ from: '2026-09-01', to: '2026-09-27', pending: { count: 1, amount: 100 }, won: { count: 1, amount: 40 }, total: { count: 2, amount: 140 } });
    expect(repo.cardRows).toHaveBeenCalledWith({ fromIso: '2026-09-01T04:00:00.000Z', toIso: '2026-09-28T04:00:00.000Z' });
    await service.summary({ from: '2026-09-01', to: '2026-09-27' }, caller());
    expect(repo.cardRows).toHaveBeenCalledTimes(1);
  });

  it('never caches a technician’s own cards', async () => {
    const { service, redis } = make();
    const s = await service.summary({}, caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' }));
    expect(s.total).toEqual({ count: 1, amount: 40 });
    expect(redis.client.set).not.toHaveBeenCalled();
  });

  it('names the author: Workiz’s name on imports, the user’s name on estimates made here', async () => {
    const { service, users } = make([est({ createdByName: 'Kris Support Manager', createdBy: 'workiz-import' }), est({ id: 'e-2' })]);
    const out = await service.exportCsv({}, caller(), 'Bearer t');
    const lines = out.csv.split('\n');
    expect(lines[0]).toBe('Estimate #,Estimate Name,Client,Email,Created,Created By,Amount,Status,Job');
    expect(lines[1]).toContain(',Kris Support Manager,');
    expect(lines[2]).toContain(',Dana Office,');
    expect(users.namesByIds).toHaveBeenCalledWith(['u-1']);
    expect(out.filename).toBe('estimates-all-time.csv');
  });
});

describe('EstimatesService keeps Workiz’s Amount only while the estimate is Workiz’s', () => {
  it('drops workizTotal when a line changes the price', async () => {
    const stored = est({ workizTotal: 90 });
    const repo = {
      get: jest.fn(async () => ({ estimate: stored, items: [] })),
      putItem: jest.fn(),
      update: jest.fn(async (_id: string, set: object) => ({ ...stored, ...set })),
    };
    const service = new EstimatesService(repo as any, {} as any);
    await service.addItem('e-1', { productId: 'p', name: 'Rekey', sku: 'R', quantity: 1, priceClient: 10, costCompany: 0, costForTech: 0 }, caller());
    expect(repo.update).toHaveBeenLastCalledWith('e-1', expect.objectContaining({ totals: expect.any(Object) }), ['workizTotal']);
  });
});

describe('Estimates report (HTTP)', () => {
  let app: INestApplication;
  const report = {
    summary: jest.fn(async () => ({ ok: 'summary' })),
    count: jest.fn(async () => ({ total: 0, atLeast: false })),
    exportCsv: jest.fn(async () => ({ ok: 'export' })),
    list: jest.fn(async () => ({ items: [] })),
  };
  const estimates = { get: jest.fn(async () => ({ id: 'x' })) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [EstimateReportController, EstimatesController],
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
        { provide: EstimateReportService, useValue: report },
        { provide: EstimatesService, useValue: estimates },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.setGlobalPrefix('api/billing');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('routes /estimates/report… ahead of /estimates/:id and validates the query', async () => {
    const http = request(app.getHttpServer());
    expect((await http.get('/api/billing/estimates/report/summary?from=2026-09-01&to=2026-09-27')).body.data).toEqual({ ok: 'summary' });
    expect((await http.get('/api/billing/estimates/report?status=won&search=374')).status).toBe(200);
    expect((await http.get('/api/billing/estimates/report/export')).body.data).toEqual({ ok: 'export' });
    expect(estimates.get).not.toHaveBeenCalled();
    expect((await http.get('/api/billing/estimates/report?status=lost')).status).toBe(400);
    expect((await http.get('/api/billing/estimates/report?to=27.09.2026')).status).toBe(400);
  });
});
