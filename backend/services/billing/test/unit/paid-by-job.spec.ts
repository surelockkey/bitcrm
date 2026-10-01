/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import { HttpExceptionFilter } from '@bitcrm/shared';
import { PaidByJobController } from 'src/reports/paid-by-job.controller';
import { paidByJob } from 'src/reports/paid-by-job.rules';
import { PaidByJobService } from 'src/reports/paid-by-job.service';

/** What each job collected in a window — the Tax report's Paid tab, from the Payments report's lines. */
describe('paidByJob', () => {
  it('nets refunds, leaves tips out, ignores what has not settled', () => {
    const out = paidByJob([
      { dealId: 'a', amount: 110, tip: 10 },
      { dealId: 'a', amount: -25.5, tip: 0 },
      { dealId: 'b', amount: 50.1, tip: 0, status: 'succeeded' },
      { dealId: 'b', amount: 99, tip: 0, status: 'pending' },
      { dealId: 'c', amount: 0, tip: 0, status: 'failed' },
    ]);
    expect(out).toEqual([
      { dealId: 'a', paid: 74.5 },
      { dealId: 'b', paid: 50.1 },
    ]);
  });
});

describe('PaidByJobService', () => {
  it('walks the months of the window on New York day boundaries', async () => {
    const walkLines = jest.fn(async () => ({ lines: [{ dealId: 'a', amount: 10, tip: 0 }], exhausted: true }));
    const service = new PaidByJobService({ walkLines } as any);
    await expect(service.window('2026-08-30', '2026-09-27')).resolves.toEqual([{ dealId: 'a', paid: 10 }]);
    expect(walkLines).toHaveBeenCalledWith(
      expect.objectContaining({
        cursor: { ms: ['2026-08', '2026-09'] },
        fromIso: '2026-08-30T04:00:00.000Z',
        toIso: '2026-09-28T04:00:00.000Z',
        dir: 'asc',
      }),
    );
  });
});

describe('GET /reports/internal/paid-by-job', () => {
  let app: INestApplication;
  const service = { window: jest.fn(async () => [{ dealId: 'a', paid: 1 }]) };

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_SECRET = process.env.INTERNAL_SERVICE_SECRET || 'test-secret';
    const mod = await Test.createTestingModule({
      controllers: [PaidByJobController],
      providers: [{ provide: PaidByJobService, useValue: service }],
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

  it('answers a window and refuses one it cannot read', async () => {
    const http = request(app.getHttpServer());
    const secret = process.env.INTERNAL_SERVICE_SECRET!;
    const get = (q: string) => http.get(`/api/billing/reports/internal/paid-by-job${q}`).set('x-internal-secret', secret);
    const ok = await get('?from=2026-09-01&to=2026-09-27');
    expect(ok.body.data).toEqual([{ dealId: 'a', paid: 1 }]);
    expect((await get('?from=2026-09-27&to=2026-09-01')).status).toBe(400);
    expect((await get('?from=x&to=2026-09-01')).status).toBe(400);
    // Nobody but a service with the secret.
    expect((await http.get('/api/billing/reports/internal/paid-by-job?from=2026-09-01&to=2026-09-27')).status).toBe(403);
  });
});
