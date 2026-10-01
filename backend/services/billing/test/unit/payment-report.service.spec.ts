/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import { DataScope, type Payment, type PaymentRefund } from '@bitcrm/types';
import { PaymentReportProjector } from 'src/payments/report/payment-report.projector';
import { PaymentReportService } from 'src/payments/report/payment-report.service';
import { billingView, caller, deal as dealOf, mockDealClient } from './mocks';
import { payment } from './payment-mocks';
import { FakeReportRepo } from './payment-report.fakes';

const TECH = '0f8fad5b-d9cb-469f-a165-70867728950e';
const OTHER_TECH = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

async function seeded(rows: Array<{ p: Partial<Payment>; refunds?: PaymentRefund[] }>) {
  const repo = new FakeReportRepo();
  const deal = mockDealClient();
  deal.getBillingView.mockImplementation(async (id: string) =>
    billingView({ id, assignedTechIds: [TECH], serviceAreaId: 'area-ct', dealNumber: `J-${id}` } as any),
  );
  const projector = new PaymentReportProjector(repo as any, deal as any);
  for (const { p, refunds } of rows) {
    const full = payment(p);
    repo.putPayment(full, refunds ?? []);
    await projector.projectOrThrow(full.id);
  }
  (deal as any).getDealsByIds = jest.fn(async (ids: string[]) =>
    ids.map((id) => dealOf({ id, dealNumber: `J-${id}`, jobTypeId: 'jt-lock', superStatus: 'done' as any })),
  );
  (deal as any).listJobTypes = jest.fn(async () => [{ id: 'jt-lock', name: 'Lockout' }]);
  const crm = { contactNamesByIds: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, firstName: 'Jane', lastName: 'Doe' }))) };
  const users = {
    namesByIds: jest.fn(async (ids: string[]) =>
      ids.map((id) => ({ id, firstName: id === TECH ? 'Tom' : 'Kate', lastName: id === TECH ? 'Tech' : 'Office' })),
    ),
  };
  const service = new PaymentReportService(repo as any, deal as any, crm as any, users as any);
  return { repo, deal, crm, users, service };
}

const september = [
  { p: { id: 'p1', dealId: 'd1', invoiceId: 'd1', amount: 100, tipAmount: 20, stripePaymentIntentId: 'pi', last4: '4242', takenAt: '2026-09-03T15:00:00.000Z' } },
  { p: { id: 'p2', dealId: 'd2', invoiceId: 'd2', method: 'cash' as const, source: 'office' as const, takenBy: OTHER_TECH, amount: 50, takenAt: '2026-09-05T15:00:00.000Z' } },
  { p: { id: 'p3', dealId: 'd3', invoiceId: 'd3', method: 'check' as const, source: 'office' as const, takenBy: 'u', amount: 70, reference: 'CHK-1', technicianId: OTHER_TECH, takenAt: '2026-08-20T15:00:00.000Z' } },
  {
    p: { id: 'p4', dealId: 'd4', invoiceId: 'd4', amount: 200, refundedAmount: 30, stripePaymentIntentId: 'pi4', takenAt: '2026-08-28T15:00:00.000Z' },
    refunds: [
      { id: 'r4', paymentId: 'p4', invoiceId: 'd4', amount: 30, status: 'succeeded', refundedBy: 'u', stripeRefundId: 're', createdAt: '2026-09-10T15:00:00.000Z', updatedAt: '2026-09-10T15:00:00.000Z' } as PaymentRefund,
    ],
  },
];

describe('PaymentReportService', () => {
  it('first page: the lines newest first, with the WHOLE range’s totals', async () => {
    const { service } = await seeded(september);
    const page = await service.list({ from: '2026-09-01', to: '2026-09-30', limit: 2 }, caller());
    expect(page.items.map((r) => [r.id, r.amount])).toEqual([
      ['r4', -30],
      ['p2', 50],
    ]);
    // p1 (120 incl. tip) + p2 (50) + refund (−30); p3 and p4 are August.
    expect(page.totals).toMatchObject({ count: 3, amount: 140, tips: 20 });
    expect(page.nextCursor).toBeDefined();

    const next = await service.list({ from: '2026-09-01', to: '2026-09-30', limit: 2, cursor: page.nextCursor }, caller());
    expect(next.items.map((r) => r.id)).toEqual(['p1']);
    expect(next.totals).toBeUndefined();
    expect(next.nextCursor).toBeUndefined();
  });

  it('rows carry Workiz’s columns, names joined in', async () => {
    const { service } = await seeded(september);
    const { items } = await service.list({ from: '2026-09-03', to: '2026-09-03' }, caller(), 'Bearer x');
    expect(items[0]).toMatchObject({
      id: 'p1',
      dealNumber: 'J-d1',
      amount: 120,
      tip: 20,
      type: 'charge',
      typeLabel: 'Credit charge',
      status: 'succeeded',
      clientName: 'Jane Doe',
      card: 'XXXX4242',
      technicianName: 'Tom Tech',
      jobTypeName: 'Lockout',
      jobStatus: 'Done',
    });
  });

  it('a peer that is down leaves names empty instead of failing the report', async () => {
    const { service, crm, users } = await seeded(september);
    crm.contactNamesByIds.mockRejectedValue(new Error('crm down'));
    users.namesByIds.mockRejectedValue(new Error('user down'));
    const { items } = await service.list({ from: '2026-09-03', to: '2026-09-03' }, caller());
    expect(items[0].clientName).toBeUndefined();
    expect(items[0].technicianName).toBeUndefined();
    expect(items[0].amount).toBe(120);
  });

  it('Type / Technician filters: OR inside a group, AND between; Refund covers both refund kinds', async () => {
    const { service } = await seeded(september);
    const all = { from: '2026-08-01', to: '2026-09-30' };
    expect((await service.totals({ ...all, types: ['refund'] }, caller())).amount).toBe(-30);
    expect((await service.totals({ ...all, types: ['cash', 'check'] }, caller())).amount).toBe(120);
    expect((await service.totals({ ...all, types: ['cash', 'check'], technicianIds: [OTHER_TECH] }, caller())).count).toBe(1);
    const page = await service.list({ ...all, technicianIds: [OTHER_TECH] }, caller());
    expect(page.items.map((r) => r.id)).toEqual(['p3']);
  });

  it('assigned_only sees only the jobs they lead, whatever filter they send', async () => {
    const { service } = await seeded(september);
    const tech = caller(DataScope.ASSIGNED_ONLY, { id: OTHER_TECH });
    const page = await service.list({ from: '2026-08-01', to: '2026-09-30', technicianIds: [TECH] }, tech);
    expect(page.items.map((r) => r.id)).toEqual(['p3']);
    expect(page.totals?.count).toBe(1);
  });

  it('All time runs from the first month the report has seen', async () => {
    const { service } = await seeded(september);
    const totals = await service.totals({}, caller());
    expect(totals).toMatchObject({ count: 5, amount: 410, tips: 20 });
    expect(totals.byType).toEqual({
      cash: { count: 1, amount: 50, tips: 0 },
      charge: { count: 2, amount: 320, tips: 20 },
      check: { count: 1, amount: 70, tips: 0 },
      refund: { count: 1, amount: -30, tips: 0 },
    });
  });

  it('nothing projected yet: All time is empty, not an error', async () => {
    const { service } = await seeded([]);
    expect(await service.list({}, caller())).toEqual({ items: [], totals: expect.objectContaining({ count: 0 }) });
  });

  it('search: job number, confirmation, amount — totals follow the search', async () => {
    const { service } = await seeded(september);
    const all = { from: '2026-08-01', to: '2026-09-30' };
    expect((await service.list({ ...all, search: 'chk-1' }, caller())).items.map((r) => r.id)).toEqual(['p3']);
    const byAmount = await service.list({ ...all, search: '120' }, caller());
    expect(byAmount.items.map((r) => r.id)).toEqual(['p1']);
    expect(byAmount.totals).toMatchObject({ count: 1, amount: 120 });
    expect((await service.list({ ...all, search: 'J-d4' }, caller())).items.map((r) => r.id)).toEqual(['r4', 'p4']);
  });

  it('oldest first on request', async () => {
    const { service } = await seeded(september);
    const page = await service.list({ from: '2026-08-01', to: '2026-09-30', dir: 'asc' }, caller());
    expect(page.items.map((r) => r.id)).toEqual(['p3', 'p4', 'p1', 'p2', 'r4']);
  });

  it('refuses dates it cannot read and ranges that run backwards', async () => {
    const { service } = await seeded(september);
    await expect(service.list({ from: '2026-13-01' }, caller())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list({ from: '2026-09-30', to: '2026-09-01' }, caller())).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.list({ from: '2026-09-01', to: '2026-09-30', cursor: 'not-a-cursor' }, caller())).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('exports Workiz’s CSV for the whole range', async () => {
    const { service } = await seeded(september);
    const out = await service.exportCsv({ from: '2026-09-01', to: '2026-09-30' }, caller(), 'Bearer x');
    const lines = out.csv.trim().split('\n');
    expect(out).toMatchObject({ filename: 'Payment report.csv', count: 3, truncated: false });
    expect(lines[0].startsWith('Job ID,Document,Payment type,Status,Amount,Service Fee,Net,Tips')).toBe(true);
    expect(lines[1]).toContain('J-d4,Job J-d4,Refund,Refunded,-30.00');
    expect(lines[3]).toContain('J-d1,Job J-d1,Credit charge,Paid,120.00,0.00,120.00,20.00,Tom Tech,Jane Doe');
  });
});
