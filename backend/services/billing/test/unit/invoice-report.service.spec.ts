/* eslint-disable @typescript-eslint/no-explicit-any */
import { Test } from '@nestjs/testing';
import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import request from 'supertest';
import { HttpExceptionFilter } from '@bitcrm/shared';
import type { Invoice } from '@bitcrm/types';
import { CrmClient } from 'src/integrations/crm.client';
import { DealClient } from 'src/integrations/deal.client';
import { InvoicesController } from 'src/invoices/invoices.controller';
import { InvoicesService } from 'src/invoices/invoices.service';
import { InvoiceReportController } from 'src/invoices/report/invoice-report.controller';
import { InvoiceReportRepository } from 'src/invoices/report/invoice-report.repository';
import { InvoiceReportService } from 'src/invoices/report/invoice-report.service';
import { UnpaidInvoicesRepository } from 'src/invoices/unpaid-invoices.repository';
import { DataScope, caller, perms, user } from './mocks';

const NOW = '2026-09-29T19:30:00.000Z'; // 15:30 in New York

let n = 0;
const inv = (over: Partial<Invoice> & { balance?: number; paid?: number } = {}): Invoice => {
  const { balance = 100, paid = 0, ...rest } = over;
  n++;
  return {
    id: `i-${n}`,
    number: `N${n}`,
    dealId: `d-${n}`,
    contactId: `c-${n}`,
    invoiceDate: '2026-09-01',
    paymentTerms: 'cash',
    dueDate: '2026-09-29',
    status: balance > 0 ? 'due' : 'paid',
    totals: { lineCount: 1, subtotal: balance + paid, taxableSubtotal: 0, nonTaxableSubtotal: 0, discount: 0, taxableBase: 0, taxRatePercent: 0, tax: 0, total: balance + paid, amountPaid: paid, balanceDue: balance },
    version: 1,
    createdBy: 'u',
    createdAt: '2026-09-10T15:00:00.000Z',
    updatedAt: '2026-09-10T15:00:00.000Z',
    ...rest,
  } as Invoice;
};

function make(open: Invoice[], opts: { indexReady?: boolean; mine?: string[] } = {}) {
  const unpaid = { listUnpaid: jest.fn(async () => ({ items: open, indexReady: opts.indexReady ?? true })) };
  const listRepo = {
    page: jest.fn(async () => ({ items: [inv({ balance: 0, paid: 5 })], nextCursor: 'next' })),
    count: jest.fn(async () => ({ total: 78_000, atLeast: false })),
    walk: jest.fn(async () => ({ items: [inv({ balance: 0, paid: 5 })], truncated: false })),
  };
  const crm = {
    contactsAs: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: 'Ann', lastName: id, emails: [`${id}@x.com`], phones: [] }))),
    contactNamesByIds: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: 'Only', lastName: id }))),
  };
  const deal = { listDealIdsByTech: jest.fn(async () => new Set(opts.mine ?? [])) };
  const invoices = { needingInvoice: jest.fn(async () => [{ id: 'j1' }, { id: 'j2' }]) };
  const service = new InvoiceReportService(unpaid as any, listRepo as any, crm as any, deal as any, invoices as any);
  return { service, unpaid, listRepo, crm, deal, invoices };
}

describe('InvoiceReportService', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(NOW)));
  afterEach(() => jest.useRealTimers());

  describe('aging', () => {
    const open = () => [
      inv({ dueDate: '2026-10-05', balance: 10 }),
      inv({ dueDate: '2026-09-20', balance: 20 }),
      inv({ dueDate: '2019-07-16', balance: 120 }),
      inv({ status: 'paid', balance: 0, paid: 50 }), // stale: never counted
    ];

    it('answers the five cards and one page, oldest debt first, clients named as the caller', async () => {
      const { service, crm } = make(open());
      const r = await service.aging({ pageSize: 2 }, caller(), 'Bearer t');
      expect(r.asOf).toBe('2026-09-29');
      expect(r.cards.all).toEqual({ count: 3, amount: 150 });
      expect(r.cards.under30).toEqual({ count: 1, amount: 20 });
      expect(r.cards.over90).toEqual({ count: 1, amount: 120 });
      expect(r.total).toBe(3);
      expect(r.items.map((i) => i.daysLate)).toEqual([2632, 9]);
      expect(r.items[0]).toMatchObject({ clientName: expect.stringContaining('Ann'), clientEmail: expect.stringContaining('@x.com') });
      expect(crm.contactsAs).toHaveBeenCalledWith(expect.any(Array), 'Bearer t');
      expect(r.indexReady).toBe(true);
    });

    it('shows one card’s invoices when a card is picked', async () => {
      const { service } = make(open());
      const r = await service.aging({ bucket: 'under30' }, caller());
      expect(r.total).toBe(1);
      expect(r.items[0].balance).toBe(20);
      expect(r.cards.all.count).toBe(3); // the cards never shrink with the table
    });

    it('falls back to names only when the caller may not read contacts', async () => {
      const { service, crm } = make(open());
      crm.contactsAs.mockRejectedValueOnce(new Error('403'));
      const r = await service.aging({}, caller(), 'Bearer t');
      expect(r.items[0].clientName).toMatch(/^Only /);
      expect(r.items[0].clientEmail).toBeUndefined();
    });

    it('keeps a technician to their own jobs', async () => {
      const rows = open();
      const { service } = make(rows, { mine: [rows[1].dealId] });
      const r = await service.aging({}, caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' }));
      expect(r.cards.all).toEqual({ count: 1, amount: 20 });
    });

    it('exports the chosen card as Workiz’s CSV', async () => {
      const { service } = make(open());
      const out = await service.agingExport({ bucket: 'over90' }, caller());
      expect(out.count).toBe(1);
      expect(out.csv.split('\n')[0]).toBe('Invoice No.,Invoice Name,Client Name,Total,Balance,Due Date,Created At,Days By');
      expect(out.csv.split('\n')[1]).toMatch(/,120\.00,120\.00,2019-07-16 00:00:00,.*,2632$/);
    });
  });

  describe('summary', () => {
    it('windows the cards on created New York days; Need invoices stays account-wide', async () => {
      const { service } = make([
        inv({ createdAt: '2026-09-02T12:00:00.000Z', dueDate: '2026-09-02', balance: 10 }),
        inv({ createdAt: '2026-09-28T03:00:00.000Z', dueDate: '2026-10-30', balance: 20 }), // 23:00 on the 27th in NY
        inv({ createdAt: '2026-08-02T12:00:00.000Z', dueDate: '2026-08-02', balance: 40 }),
      ]);
      const s = await service.summary({ from: '2026-09-01', to: '2026-09-27' }, caller(), 'Bearer t');
      expect(s).toMatchObject({
        from: '2026-09-01',
        to: '2026-09-27',
        due: { count: 2, amount: 30 },
        overdue: { count: 1, amount: 10 },
        unsent: { count: 2 },
        needInvoices: { count: 2 },
        indexReady: true,
      });
      const all = await service.summary({}, caller(), 'Bearer t');
      expect(all.due).toEqual({ count: 3, amount: 70 });
    });
  });

  describe('list / count', () => {
    it('answers an unpaid-only filter from UnpaidIndex with an exact count', async () => {
      const open = [inv({ dueDate: '2026-09-01' }), inv({ dueDate: '2026-10-01' }), inv({ dueDate: '2026-08-01' })];
      const { service, listRepo } = make(open);
      const page1 = await service.list({ statuses: ['overdue'], limit: 1 }, caller());
      expect(page1.items).toHaveLength(1);
      expect(page1.nextCursor).toBeDefined();
      const page2 = await service.list({ statuses: ['overdue'], limit: 1, cursor: page1.nextCursor }, caller());
      expect(page2.items).toHaveLength(1);
      expect(page2.nextCursor).toBeUndefined();
      await expect(service.count({ statuses: ['overdue'] }, caller())).resolves.toEqual({ total: 2, atLeast: false });
      await expect(service.count({ daysDue: ['0_30'] }, caller())).resolves.toEqual({ total: 1, atLeast: false });
      expect(listRepo.page).not.toHaveBeenCalled();
    });

    it('walks the list index for anything that may be paid', async () => {
      const { service, listRepo, unpaid } = make([]);
      const res = await service.list({ from: '2026-09-01', to: '2026-09-27', statuses: ['paid'] }, caller());
      expect(res.nextCursor).toBe('next');
      expect(listRepo.page).toHaveBeenCalledWith(
        expect.objectContaining({ fromIso: '2026-09-01T04:00:00.000Z', toIso: '2026-09-28T04:00:00.000Z', statuses: ['paid'] }),
        '2026-09-29',
        10,
        undefined,
      );
      expect(unpaid.listUnpaid).not.toHaveBeenCalled();
      await expect(service.count({}, caller())).resolves.toEqual({ total: 78_000, atLeast: false });
      await expect(service.count({}, caller(DataScope.ASSIGNED_ONLY))).resolves.toEqual({ total: null, atLeast: false });
    });

    it('exports Workiz’s CSV with the client’s email', async () => {
      const { service } = make([]);
      const out = await service.exportCsv({ from: '2026-09-01', to: '2026-09-27' }, caller(), 'Bearer t');
      expect(out.filename).toBe('invoices-2026-09-01_2026-09-27.csv');
      const [head, row] = out.csv.split('\n');
      expect(head).toBe('Invoice NO.,Invoice Name,Client,Email Address,Created,Subtotal,Discount,Tax,Total Amount,Amount Due,Status,Job,Job name');
      expect(row).toMatch(/@x\.com/);
    });
  });
});

describe('Invoice reports (HTTP)', () => {
  let app: INestApplication;
  const report = {
    aging: jest.fn(async () => ({ ok: 'aging' })),
    agingExport: jest.fn(async () => ({ ok: 'aging-export' })),
    summary: jest.fn(async () => ({ ok: 'summary' })),
    list: jest.fn(async () => ({ items: [] })),
    count: jest.fn(async () => ({ total: 0, atLeast: false })),
    exportCsv: jest.fn(async () => ({ ok: 'export' })),
  };
  const invoices = { get: jest.fn(async () => ({ id: 'x' })) };

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [InvoiceReportController, InvoicesController],
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
        { provide: InvoiceReportService, useValue: report },
        { provide: InvoicesService, useValue: invoices },
        { provide: UnpaidInvoicesRepository, useValue: {} },
        { provide: InvoiceReportRepository, useValue: {} },
        { provide: CrmClient, useValue: {} },
        { provide: DealClient, useValue: {} },
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

  it('routes the static report paths ahead of GET /invoices/:id', async () => {
    const http = request(app.getHttpServer());
    expect((await http.get('/api/billing/invoices/aging')).body.data).toEqual({ ok: 'aging' });
    expect((await http.get('/api/billing/invoices/aging/export?bucket=over90')).body.data).toEqual({ ok: 'aging-export' });
    expect((await http.get('/api/billing/invoices/report/summary?from=2026-09-01&to=2026-09-27')).body.data).toEqual({ ok: 'summary' });
    expect((await http.get('/api/billing/invoices/report')).status).toBe(200);
    expect((await http.get('/api/billing/invoices/report/export')).body.data).toEqual({ ok: 'export' });
    expect(invoices.get).not.toHaveBeenCalled();
    expect((await http.get('/api/billing/invoices/some-id')).status).toBe(200);
    expect(invoices.get).toHaveBeenCalled();
  });

  it('reads comma lists as arrays and refuses what it cannot read', async () => {
    const http = request(app.getHttpServer());
    await http.get('/api/billing/invoices/report/count?statuses=due,overdue&daysDue=0_30&sent=unsent');
    expect((report.count.mock.calls as any[])[0][0]).toMatchObject({ statuses: ['due', 'overdue'], daysDue: ['0_30'], sent: ['unsent'] });
    expect((await http.get('/api/billing/invoices/report?statuses=lost')).status).toBe(400);
    expect((await http.get('/api/billing/invoices/report?from=09/01/2026')).status).toBe(400);
    expect((await http.get('/api/billing/invoices/aging?bucket=over120')).status).toBe(400);
    expect((await http.get('/api/billing/invoices/aging?pageSize=500')).status).toBe(400);
  });
});
