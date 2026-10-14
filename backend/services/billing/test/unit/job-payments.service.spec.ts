/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BillingEventType, DataScope, type Estimate } from '@bitcrm/types';
import { InvoicesService } from 'src/invoices/invoices.service';
import { LEDGER_READ_CONCURRENCY, PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { summarizePayments } from 'src/payments/payment-rules';
import { depositLedger } from 'src/payments/portal-payments.service';
import {
  NOW,
  billingView,
  caller,
  dealProduct,
  mockCrmClient,
  mockDealClient,
  mockDocuments,
  mockEvents,
  mockProfileService,
} from './mocks';
import { fakeInvoices, fakeLedger, invoice, mockStripeService, payment } from './payment-mocks';

/**
 * Workiz: a payment belongs to the JOB. 40k imported jobs have payments and no
 * invoice at all, so the job's ledger must work without an invoice row.
 */

/** A $150 job, no tax — easy balances. */
const jobView = (over: Record<string, unknown> = {}) =>
  billingView(
    { taxRatePercent: 0, taxSource: 'exempt' as any, ...over },
    [dealProduct({ quantity: 1, priceClient: 150, taxable: false })],
  );

/** A job estimate asking a 50 % deposit of its $200 ⇒ $100. */
const estimate = (over: Partial<Estimate> = {}): Estimate =>
  ({
    id: 'est-1',
    number: 'K4T9ZW-1',
    dealId: 'deal-1',
    dealNumber: 'K4T9ZW',
    contactId: 'contact-1',
    status: 'approved',
    estimateDate: '2026-09-20',
    totals: { subtotal: 200, discount: 0, taxRatePercent: 0, tax: 0, total: 200, amountPaid: 0, balanceDue: 200 },
    depositPercentage: 50,
    version: 1,
    createdBy: 'u-1',
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
    ...over,
  }) as Estimate;

function build(
  opts: { withInvoice?: boolean; seed?: ReturnType<typeof payment>[]; estimates?: Estimate[]; jobItems?: boolean } = {},
) {
  const ledger = fakeLedger(opts.seed ?? []);
  // An invoice for SOME OTHER job: deal-1 itself has none unless asked.
  const invoices = fakeInvoices(
    opts.withInvoice ? invoice() : invoice({ id: 'deal-other', dealId: 'deal-other' }),
    ledger,
  );
  const deal = mockDealClient();
  const view = opts.jobItems === false ? billingView({ taxRatePercent: 0, taxSource: 'exempt' as any }, []) : jobView();
  deal.getBillingView.mockImplementation(async (id: string) => (id === 'deal-1' ? view : null));
  const events = mockEvents();
  const crm = mockCrmClient();
  const messaging = { sendToContact: jest.fn(async () => undefined) };
  const stored = opts.estimates ?? [estimate()];
  const estimates = { getStored: jest.fn(async (id: string) => stored.find((e) => e.id === id) ?? null) };
  const service = new PaymentsService(
    ledger as any,
    invoices as any,
    new PaymentSettingsService(ledger as any) as any,
    deal as any,
    mockStripeService() as any,
    events as any,
    crm as any,
    messaging as any,
    undefined,
    undefined,
    estimates as any,
  );
  return { service, ledger, invoices, deal, events, messaging, estimates };
}

const imported = (over: Partial<ReturnType<typeof payment>> = {}) =>
  payment({ id: 'wz-1', method: 'cash', source: 'office', takenBy: 'u-9', amount: 100, ...over });

describe('PaymentsService — a job without an invoice (Workiz)', () => {
  it('lists the job ledger with the balance against the job total', async () => {
    const { service } = build({ seed: [imported()] });
    const res = await service.listForDeal('deal-1', caller());

    expect(res.dealId).toBe('deal-1');
    expect(res.invoiceId).toBeUndefined();
    expect(res.payments.map((p) => p.id)).toEqual(['wz-1']);
    expect(res.summary.settled).toBe(100);
    expect(res.total).toBe(150);
    expect(res.amountPaid).toBe(100);
    expect(res.balanceDue).toBe(50);
  });

  it('an empty ledger owes the whole job', async () => {
    const { service } = build();
    const res = await service.listForDeal('deal-1', caller());
    expect(res.payments).toEqual([]);
    expect(res.balanceDue).toBe(150);
  });

  it('never shows a negative balance when more was paid than the job total', async () => {
    const { service } = build({ seed: [imported({ amount: 200 })] });
    const res = await service.listForDeal('deal-1', caller());
    expect(res.balanceDue).toBe(0);
  });

  it('404s for a job that does not exist', async () => {
    const { service } = build();
    await expect(service.listForDeal('nope', caller())).rejects.toThrow(NotFoundException);
    await expect(service.recordOfflineForDeal('nope', { amount: 1, method: 'cash' }, caller())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('keeps assigned_only: a technician not on the job is refused', async () => {
    const { service } = build();
    const stranger = caller(DataScope.ASSIGNED_ONLY, { id: 'tech-9' });
    await expect(service.listForDeal('deal-1', stranger)).rejects.toThrow(ForbiddenException);
    await expect(
      service.recordOfflineForDeal('deal-1', { amount: 10, method: 'cash' }, stranger),
    ).rejects.toThrow(ForbiddenException);
  });

  it('lets the assigned technician see and collect', async () => {
    const { service } = build();
    const tech = caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' });
    const p = await service.recordOfflineForDeal('deal-1', { amount: 20, method: 'cash' }, tech);
    expect(p.source).toBe('field');
    expect((await service.listForDeal('deal-1', tech)).amountPaid).toBe(20);
  });

  it('records an offline payment in the job ledger (invoiceId === dealId)', async () => {
    const { service, ledger, deal, events, invoices } = build();
    const p = await service.recordOfflineForDeal(
      'deal-1',
      { amount: 50, method: 'check', reference: '#1042' },
      caller(),
    );

    expect(p).toMatchObject({
      invoiceId: 'deal-1',
      dealId: 'deal-1',
      contactId: 'contact-1',
      amount: 50,
      method: 'check',
      status: 'settled',
      reference: '#1042',
      takenBy: 'u-1',
    });
    expect(ledger.payments.get(p.id)).toBeTruthy();
    // No invoice to re-derive; the job board hears it against the job total.
    expect(invoices.applyAmountPaid).toHaveBeenCalledWith('deal-1', 50);
    expect(deal.setPaymentStatus).toHaveBeenCalledWith(
      'deal-1',
      expect.objectContaining({ paymentStatus: 'partial', amountPaid: 50, invoiceTotal: 150 }),
    );
    expect(events.payment).toHaveBeenCalledWith(
      BillingEventType.PAYMENT_SUCCEEDED,
      expect.objectContaining({ dealId: 'deal-1', balanceDue: 100 }),
    );
    expect(deal.addTimeline).toHaveBeenCalled();
  });

  it('marks the job paid once the job total is covered', async () => {
    const { service, deal } = build({ seed: [imported()] });
    await service.recordOfflineForDeal('deal-1', { amount: 50, method: 'cash' }, caller());
    expect(deal.setPaymentStatus).toHaveBeenLastCalledWith(
      'deal-1',
      expect.objectContaining({ paymentStatus: 'paid', amountPaid: 150 }),
    );
  });

  it('refuses more than the job balance and online methods', async () => {
    const { service } = build({ seed: [imported()] });
    await expect(
      service.recordOfflineForDeal('deal-1', { amount: 50.01, method: 'cash' }, caller()),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.recordOfflineForDeal('deal-1', { amount: 10, method: 'bank' as any }, caller()),
    ).rejects.toThrow(BadRequestException);
  });

  it('refunds a payment whose job has no invoice', async () => {
    const { service, ledger, deal } = build({ seed: [imported()] });
    const refund = await service.refund('wz-1', { amount: 30 }, caller());
    expect(refund.status).toBe('succeeded');
    expect(ledger.payments.get('wz-1')!.refundedAmount).toBe(30);
    expect(deal.setPaymentStatus).toHaveBeenLastCalledWith(
      'deal-1',
      expect.objectContaining({ amountPaid: 70, invoiceTotal: 150 }),
    );
  });

  it('deletes a mis-keyed offline payment on a job with no invoice', async () => {
    const { service, ledger } = build({ seed: [imported()] });
    await service.remove('wz-1', caller());
    expect(ledger.payments.size).toBe(0);
  });

  it('sends a receipt naming the job, with the job balance', async () => {
    const { service, messaging } = build({ seed: [imported()] });
    const res = await service.sendReceipt('wz-1', caller(), 'Bearer x');
    expect(res.sent).toBe(true);
    expect(messaging.sendToContact).toHaveBeenCalledWith(
      expect.objectContaining({ body: expect.stringContaining('Receipt for job K4T9ZW') }),
      'Bearer x',
    );
    expect((messaging.sendToContact.mock.calls[0] as any[])[0].body).toContain('Balance due: $50.00');
  });

  it('keeps the invoice routes strict: no invoice is still a 404 there', async () => {
    const { service } = build();
    await expect(service.listForInvoice('deal-1', caller())).rejects.toThrow(NotFoundException);
    await expect(service.recordOffline('deal-1', { amount: 1, method: 'cash' }, caller())).rejects.toThrow(
      NotFoundException,
    );
  });
});

describe('PaymentsService — an offline deposit on the job’s estimate (Workiz: the estimate’s Deposits)', () => {
  it('records it on the JOB’s ledger tagged with the estimate, against what is still owed of the deposit', async () => {
    const { service, ledger, deal } = build({
      seed: [imported({ id: 'dep-1', amount: 30, estimateId: 'est-1' })],
    });
    // $100 deposit, $30 already paid ⇒ $70 left.
    await expect(
      service.recordOfflineForDeal('deal-1', { amount: 70.01, method: 'cash', estimateId: 'est-1' }, caller()),
    ).rejects.toThrow(BadRequestException);

    const p = await service.recordOfflineForDeal(
      'deal-1',
      { amount: 70, method: 'check', reference: '#1042', estimateId: 'est-1' },
      caller(),
    );
    expect(p).toMatchObject({
      invoiceId: 'deal-1',
      dealId: 'deal-1',
      estimateId: 'est-1',
      contactId: 'contact-1',
      amount: 70,
      method: 'check',
      status: 'settled',
      reference: '#1042',
    });
    // Every deposit-paid computation reads the tag: the deposit is paid in full …
    const rows = await ledger.listByInvoice('deal-1');
    expect(summarizePayments(depositLedger(rows, 'est-1')).settled).toBe(100);
    // … and it counts toward the job’s balance like any payment on the job.
    const job = await service.listForDeal('deal-1', caller());
    expect(job).toMatchObject({ amountPaid: 100, total: 150, balanceDue: 50 });
    expect(deal.setPaymentStatus).toHaveBeenLastCalledWith('deal-1', expect.objectContaining({ amountPaid: 100 }));
  });

  it('takes the deposit even before the estimate’s work is on the job (the job owes nothing yet)', async () => {
    const { service } = build({ jobItems: false });
    await expect(service.recordOfflineForDeal('deal-1', { amount: 10, method: 'cash' }, caller())).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      service.recordOfflineForDeal('deal-1', { amount: 100, method: 'cash', estimateId: 'est-1' }, caller()),
    ).resolves.toMatchObject({ estimateId: 'est-1', amount: 100, status: 'settled' });
  });

  it('lands on the job’s invoice when there is one, still tagged with the estimate', async () => {
    const { service, invoices } = build({ withInvoice: true });
    const p = await service.recordOfflineForDeal('deal-1', { amount: 40, method: 'cash', estimateId: 'est-1' }, caller());
    expect(p).toMatchObject({ invoiceId: 'deal-1', estimateId: 'est-1' });
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 40);
  });

  it('refuses an estimate that is not this job’s or this client’s, a client estimate, one asking no deposit, an unknown one', async () => {
    const { service, ledger } = build({
      estimates: [
        estimate({ id: 'est-other-job', dealId: 'deal-2' }),
        estimate({ id: 'est-other-client', contactId: 'contact-9' }),
        estimate({ id: 'est-client', dealId: undefined, dealNumber: undefined }),
        estimate({ id: 'est-no-deposit', depositPercentage: undefined }),
      ],
    });
    const record = (estimateId: string) =>
      service.recordOfflineForDeal('deal-1', { amount: 10, method: 'cash', estimateId }, caller());
    await expect(record('est-other-job')).rejects.toThrow(ConflictException);
    await expect(record('est-other-client')).rejects.toThrow(ConflictException);
    await expect(record('est-client')).rejects.toThrow(ConflictException);
    await expect(record('est-no-deposit')).rejects.toThrow(/does not ask for a deposit/);
    await expect(record('nope')).rejects.toThrow(BadRequestException);
    expect(ledger.payments.size).toBe(0);
  });

  it('keeps the roster rule: a technician off the job cannot record a deposit on it', async () => {
    const { service, estimates } = build();
    await expect(
      service.recordOfflineForDeal(
        'deal-1',
        { amount: 10, method: 'cash', estimateId: 'est-1' },
        caller(DataScope.ASSIGNED_ONLY, { id: 'tech-9' }),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(estimates.getStored).not.toHaveBeenCalled();
  });
});

describe('PaymentsService — a job WITH an invoice, through the job routes', () => {
  it('reports the invoice id and behaves exactly like the invoice route', async () => {
    const { service, invoices } = build({ withInvoice: true });
    const p = await service.recordOfflineForDeal('deal-1', { amount: 40, method: 'cash' }, caller());
    expect(p.invoiceId).toBe('deal-1');
    expect(invoices.stored.totals.balanceDue).toBe(60);

    const res = await service.listForDeal('deal-1', caller());
    expect(res.invoiceId).toBe('deal-1');
    expect(res.amountPaid).toBe(40);
  });
});

describe('InvoicesService.create — picks up a ledger that already exists', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date(NOW)));
  afterEach(() => jest.useRealTimers());

  it('an invoice created later for a paid-without-invoice job starts with that amountPaid', async () => {
    const ledger = fakeLedger([imported({ amount: 150 })]);
    const store = new Map<string, any>();
    const repo = {
      create: jest.fn(async (inv: any) => void store.set(inv.id, inv)),
      get: jest.fn(async (id: string) => store.get(id) ?? null),
      delete: jest.fn(async (id: string) => void store.delete(id)),
    };
    const deal = mockDealClient();
    deal.getBillingView.mockResolvedValue(jobView());
    const service = new InvoicesService(
      repo as never,
      deal as never,
      mockCrmClient() as never,
      mockProfileService() as never,
      mockDocuments() as never,
      mockEvents() as never,
      undefined,
      ledger as never,
    );

    const inv = await service.create('deal-1', caller());
    expect(ledger.listByInvoice).toHaveBeenCalledWith('deal-1');
    expect(inv.totals.amountPaid).toBe(150);
    expect(inv.totals.balanceDue).toBe(0);
    expect(inv.status).toBe('paid');
  });
});

describe('PaymentsService.accessibleJob / ledgerForJob — the access check without the ledger', () => {
  it("decides access from the job alone: no invoice, no ledger read", async () => {
    const { service, ledger, invoices } = build({ seed: [imported()] });
    const view = await service.accessibleJob('deal-1', caller());
    expect(view.deal.id).toBe('deal-1');
    expect(ledger.listByInvoice).not.toHaveBeenCalled();
    expect(invoices.getStored).not.toHaveBeenCalled();
  });

  it('keeps assigned_only and the 404, exactly as listForDeal does', async () => {
    const { service } = build();
    await expect(service.accessibleJob('deal-1', caller(DataScope.ASSIGNED_ONLY, { id: 'tech-9' }))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.accessibleJob('nope', caller())).rejects.toThrow(NotFoundException);
    const tech = caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' });
    await expect(service.accessibleJob('deal-1', tech)).resolves.toBeTruthy();
  });

  it('ledgerForJob reads the invoice and the ledger side by side', async () => {
    const { service, ledger, invoices } = build({ seed: [imported()], withInvoice: true });
    const view = await service.accessibleJob('deal-1', caller());
    let releaseInvoice!: () => void;
    const original = invoices.getStored.getMockImplementation()!;
    invoices.getStored.mockImplementation(async (id: string) => {
      await new Promise<void>((r) => (releaseInvoice = r));
      return original(id);
    });

    const answer = service.ledgerForJob(view);
    await new Promise((r) => setImmediate(r));
    expect(ledger.listByInvoice).toHaveBeenCalledWith('deal-1');
    releaseInvoice();
    await expect(answer).resolves.toMatchObject({ dealId: 'deal-1', invoiceId: 'deal-1' });
  });

  it('ledgerForJob(accessibleJob(...)) is listForDeal', async () => {
    const { service } = build({ seed: [imported()], withInvoice: true });
    const composed = await service.ledgerForJob(await service.accessibleJob('deal-1', caller()));
    expect(composed).toEqual(await service.listForDeal('deal-1', caller()));
  });
});

describe('PaymentsService.ledgersByDeals — the commissions report (internal)', () => {
  it('reads each job once, with or without an invoice, and maps a job with no payments to []', async () => {
    const { service, ledger } = build({
      seed: [imported(), imported({ id: 'wz-2', method: 'card', amount: 50 }), imported({ id: 'wz-3', invoiceId: 'deal-2', dealId: 'deal-2' })],
    });
    const out = await service.ledgersByDeals(['deal-1', 'deal-2', 'deal-1', 'deal-none', '']);
    expect(Object.keys(out).sort()).toEqual(['deal-1', 'deal-2', 'deal-none']);
    expect(out['deal-1'].map((p) => p.id).sort()).toEqual(['wz-1', 'wz-2']);
    expect(out['deal-2']).toHaveLength(1);
    expect(out['deal-none']).toEqual([]);
    expect(ledger.listByInvoice).toHaveBeenCalledTimes(3);
  });

  it('caps a request at 100 jobs and ignores a body that is not a list', async () => {
    const { service, ledger } = build();
    const many = Array.from({ length: 150 }, (_, i) => `deal-${i}`);
    expect(Object.keys(await service.ledgersByDeals(many))).toHaveLength(100);
    expect(ledger.listByInvoice).toHaveBeenCalledTimes(100);
    expect(await service.ledgersByDeals('deal-1' as any)).toEqual({});
  });

  it('a slow ledger does not hold back the rest (a pool, not waves)', async () => {
    const { service, ledger } = build();
    let releaseSlow!: () => void;
    const started = new Set<string>();
    ledger.listByInvoice.mockImplementation(async (id: string) => {
      started.add(id);
      if (id === 'deal-0') await new Promise<void>((r) => (releaseSlow = r));
      else await new Promise((r) => setImmediate(r));
      return [];
    });
    const done = service.ledgersByDeals(Array.from({ length: 100 }, (_, i) => `deal-${i}`));
    for (let i = 0; i < 50 && started.size < 100; i++) await new Promise((r) => setImmediate(r));
    // With waves, deal-50…99 would wait for deal-0; with a pool they all start.
    expect(started.size).toBe(100);
    releaseSlow();
    expect(Object.keys(await done)).toHaveLength(100);
  });

  it(`keeps ${LEDGER_READ_CONCURRENCY} ledger reads in flight at once, never more`, async () => {
    expect(LEDGER_READ_CONCURRENCY).toBe(50);
    const { service, ledger } = build();
    let inFlight = 0;
    let peak = 0;
    ledger.listByInvoice.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setImmediate(r));
      inFlight--;
      return [];
    });
    const out = await service.ledgersByDeals(Array.from({ length: 100 }, (_, i) => `deal-${i}`));
    expect(Object.keys(out)).toHaveLength(100);
    expect(peak).toBe(LEDGER_READ_CONCURRENCY);
  });
});

/**
 * Phase C — the Payments tab used to wait for the job's billing view (an
 * HTTP hop to deal-service) BEFORE reading the invoice and the ledger. The
 * two reads are side-effect free and keyed by the job id the caller asked
 * for, so they now run beside the view; nothing they found is answered
 * until the view has let the caller through.
 */
describe('PaymentsService.listForDeal — the reads beside the access check', () => {
  it('asks the invoice and the ledger while the job view is still in flight', async () => {
    const { service, ledger, invoices, deal } = build({ seed: [imported()], withInvoice: true });
    let releaseView!: () => void;
    const original = deal.getBillingView.getMockImplementation()!;
    deal.getBillingView.mockImplementation(async (id: string) => {
      await new Promise<void>((r) => (releaseView = r));
      return original(id);
    });

    const answer = service.listForDeal('deal-1', caller());
    await new Promise((r) => setImmediate(r));
    expect(ledger.listByInvoice).toHaveBeenCalledWith('deal-1');
    expect(invoices.getStored).toHaveBeenCalledWith('deal-1');
    releaseView();
    await expect(answer).resolves.toMatchObject({ dealId: 'deal-1', invoiceId: 'deal-1', amountPaid: 100 });
  });

  it('the answer is exactly the one the sequential path gave', async () => {
    const { service } = build({ seed: [imported()], withInvoice: true });
    const sequential = await service.ledgerForJob(await service.accessibleJob('deal-1', caller()));
    expect(await service.listForDeal('deal-1', caller())).toEqual(sequential);
  });

  it('a technician not on the job still gets 403 — and a missing job 404 — whatever the reads found', async () => {
    const { service } = build({ seed: [imported()], withInvoice: true });
    await expect(service.listForDeal('deal-1', caller(DataScope.ASSIGNED_ONLY, { id: 'tech-9' }))).rejects.toThrow(
      ForbiddenException,
    );
    await expect(service.listForDeal('nope', caller())).rejects.toThrow(NotFoundException);
  });

  it('a ledger read that fails for a caller who may not see the job still answers 403, not the read error', async () => {
    const { service, ledger } = build({ seed: [imported()] });
    ledger.listByInvoice.mockRejectedValue(new Error('throttled'));
    await expect(service.listForDeal('deal-1', caller(DataScope.ASSIGNED_ONLY, { id: 'tech-9' }))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
