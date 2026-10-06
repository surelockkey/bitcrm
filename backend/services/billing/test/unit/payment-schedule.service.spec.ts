import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { JobPaymentLedger, PaymentSchedule } from '@bitcrm/types';
import { PaymentScheduleService } from 'src/payment-schedule/payment-schedule.service';
import { caller } from './mocks';

const ledger = (over: Partial<JobPaymentLedger> = {}): JobPaymentLedger =>
  ({
    dealId: 'd1',
    invoiceId: 'd1',
    payments: [],
    summary: { settled: 0 } as JobPaymentLedger['summary'],
    total: 584.93,
    amountPaid: 0,
    balanceDue: 584.93,
    ...over,
  }) as JobPaymentLedger;

const stored = (over: Partial<PaymentSchedule> = {}): PaymentSchedule => ({
  dealId: 'd1',
  method: 'percent',
  entries: [
    { id: 'p1', percent: 50, dueDate: '2026-10-06' },
    { id: 'p2', percent: 50, dueDate: '2026-10-07', note: 'Balance' },
  ],
  updatedAt: '2026-10-06T12:00:00.000Z',
  updatedBy: 'u1',
  ...over,
});

function setup(opts: { ledger?: JobPaymentLedger; schedule?: PaymentSchedule | null } = {}) {
  const repo = {
    get: jest.fn().mockResolvedValue(opts.schedule === undefined ? stored() : opts.schedule),
    put: jest.fn().mockImplementation(async (s: PaymentSchedule) => s),
    delete: jest.fn().mockResolvedValue(undefined),
  };
  const payments = { listForDeal: jest.fn().mockResolvedValue(opts.ledger ?? ledger()) };
  const invoices = { pdf: jest.fn().mockResolvedValue({ url: 'https://s3/doc.pdf' }) };
  const service = new PaymentScheduleService(repo as never, payments as never, invoices as never, () => '2026-10-06');
  return { service, repo, payments, invoices };
}

/**
 * Workiz's Payment schedule on a job: kept by billing against the job's own
 * ledger, so a technician on the job (`payments` assigned-only) reads and
 * sets it, and each payment's figures come from what the job has been paid.
 */
describe('PaymentScheduleService', () => {
  it("reads the job's schedule against its ledger", async () => {
    const { service, payments } = setup();
    const view = await service.get('d1', caller());

    expect(payments.listForDeal).toHaveBeenCalledWith('d1', expect.anything());
    expect(view).toMatchObject({ dealId: 'd1', method: 'percent', total: 584.93, balanceDue: 584.93 });
    expect(view!.lines.map((l) => [l.amount, l.status])).toEqual([
      [292.47, 'due'],
      [292.46, 'future'],
    ]);
    expect(view!.lines[1].note).toBe('Balance');
  });

  it('answers nothing for a job without a schedule', async () => {
    const { service } = setup({ schedule: null });
    expect(await service.get('d1', caller())).toBeNull();
  });

  it("refuses a job the caller may not see — the ledger's own check", async () => {
    const { service, payments } = setup();
    payments.listForDeal.mockRejectedValue(new ForbiddenException('You are not assigned to this job'));
    await expect(service.get('d1', caller())).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('saves a schedule that adds up to the job, numbering new payments', async () => {
    const { service, repo } = setup({ schedule: null });
    const view = await service.save(
      'd1',
      { method: 'percent', entries: [{ percent: 30, dueDate: '2026-10-06' }, { id: 'keep', percent: 70, dueDate: '2026-11-06' }] },
      caller(),
    );

    const saved = repo.put.mock.calls[0][0] as PaymentSchedule;
    expect(saved.dealId).toBe('d1');
    expect(saved.entries[0].id).toEqual(expect.any(String));
    expect(saved.entries[1].id).toBe('keep');
    expect(view.lines.map((l) => l.amount)).toEqual([175.48, 409.45]);
  });

  it("refuses one that does not add up, and stores nothing", async () => {
    const { service, repo } = setup({ schedule: null });
    await expect(
      service.save('d1', { method: 'percent', entries: [{ percent: 60, dueDate: '2026-10-06' }] }, caller()),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('deletes the schedule of a job the caller may see', async () => {
    const { service, repo, payments } = setup();
    await service.remove('d1', caller());
    expect(payments.listForDeal).toHaveBeenCalled();
    expect(repo.delete).toHaveBeenCalledWith('d1');
  });

  /** Workiz's View on a payment: the invoice, its Balance due that payment's. */
  it("renders the invoice for one payment, its balance due what is left of that payment", async () => {
    const { service, invoices } = setup({ ledger: ledger({ amountPaid: 300, balanceDue: 284.93 }) });
    await service.pdf('d1', 'p2', false, caller());
    expect(invoices.pdf).toHaveBeenCalledWith('d1', false, expect.anything(), { balanceDue: 284.93 });
  });

  it('says the invoice comes first when the job has none', async () => {
    const { service } = setup({ ledger: ledger({ invoiceId: undefined }) });
    await expect(service.pdf('d1', 'p1', false, caller())).rejects.toBeInstanceOf(ConflictException);
  });

  it('knows no payment it was not given', async () => {
    const { service } = setup();
    await expect(service.pdf('d1', 'nope', false, caller())).rejects.toBeInstanceOf(NotFoundException);
  });
});
