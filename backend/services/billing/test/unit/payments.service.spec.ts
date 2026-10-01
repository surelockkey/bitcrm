/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { BillingEventType, DataScope, MAX_SURCHARGE_PERCENT } from '@bitcrm/types';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { caller, mockCrmClient, mockDealClient, mockEvents } from './mocks';
import { fakeInvoices, fakeLedger, invoice, mockStripeService, payment } from './payment-mocks';

function build(over: { ledger?: ReturnType<typeof fakeLedger>; stripe?: any } = {}) {
  const ledger = over.ledger ?? fakeLedger();
  const invoices = fakeInvoices(invoice(), ledger);
  const settings = new PaymentSettingsService(ledger as any);
  const deal = mockDealClient();
  const stripe = over.stripe === null ? undefined : (over.stripe ?? mockStripeService());
  const events = mockEvents();
  const crm = mockCrmClient();
  const messaging = { sendToContact: jest.fn(async () => undefined) };
  const service = new PaymentsService(
    ledger as any,
    invoices as any,
    settings as any,
    deal as any,
    stripe as any,
    events as any,
    crm as any,
    messaging as any,
  );
  return { service, ledger, invoices, settings, deal, stripe, events, crm, messaging };
}

describe('PaymentsService — offline payments', () => {
  it('records an offline payment as settled immediately', async () => {
    const { service, ledger, invoices } = build();
    const p = await service.recordOffline('deal-1', { amount: 40, method: 'cash', reference: 'env #12' }, caller());

    expect(p.status).toBe('settled');
    expect(p.amount).toBe(40);
    expect(p.method).toBe('cash');
    expect(p.reference).toBe('env #12');
    expect(p.settledAt).toBeTruthy();
    expect(p.stripePaymentIntentId).toBeUndefined();
    expect(ledger.payments.size).toBe(1);
    // The invoice re-derives itself from the ledger.
    expect(invoices.applyAmountPaid).toHaveBeenCalledWith('deal-1', 40);
    expect(invoices.stored.status).toBe('due');
    expect(invoices.stored.totals.balanceDue).toBe(60);
  });

  it('marks the invoice paid and tells deal-service once the balance is covered', async () => {
    const { service, invoices, deal } = build();
    await service.recordOffline('deal-1', { amount: 100, method: 'check' }, caller());
    expect(invoices.stored.status).toBe('paid');
    expect(deal.setPaymentStatus).toHaveBeenCalledWith(
      'deal-1',
      expect.objectContaining({ paymentStatus: 'paid', amountPaid: 100 }),
    );
  });

  it('reports a partial payment to the job board as `partial`', async () => {
    const { service, deal } = build();
    await service.recordOffline('deal-1', { amount: 25, method: 'cash' }, caller());
    expect(deal.setPaymentStatus).toHaveBeenCalledWith(
      'deal-1',
      expect.objectContaining({ paymentStatus: 'partial', amountPaid: 25 }),
    );
  });

  it('publishes payment.succeeded and writes a job timeline entry', async () => {
    const { service, events, deal } = build();
    await service.recordOffline('deal-1', { amount: 100, method: 'cash' }, caller());
    expect(events.payment).toHaveBeenCalledWith(
      BillingEventType.PAYMENT_SUCCEEDED,
      expect.objectContaining({ amount: 100, status: 'settled', balanceDue: 0 }),
    );
    expect(deal.addTimeline).toHaveBeenCalled();
  });

  it('refuses a zero, negative or over-the-balance amount', async () => {
    const { service } = build();
    for (const amount of [0, -1, 100.01]) {
      await expect(service.recordOffline('deal-1', { amount, method: 'cash' }, caller())).rejects.toThrow(
        BadRequestException,
      );
    }
  });

  it('refuses an online method — cash, check, card in person or other only', async () => {
    const { service } = build();
    await expect(
      service.recordOffline('deal-1', { amount: 10, method: 'bank' as any }, caller()),
    ).rejects.toThrow(BadRequestException);
  });

  it('404s for an invoice that does not exist', async () => {
    const { service } = build();
    await expect(service.recordOffline('nope', { amount: 10, method: 'cash' }, caller())).rejects.toThrow(
      NotFoundException,
    );
  });

  it('stamps a technician’s payment as taken in the field', async () => {
    const { service } = build();
    const tech = caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' });
    const p = await service.recordOffline('deal-1', { amount: 10, method: 'cash' }, tech);
    expect(p.source).toBe('field');
    expect(p.takenBy).toBe('tech-1');
  });

  it('refuses a technician who is not assigned to the job', async () => {
    const { service, deal } = build();
    deal.getBillingView.mockResolvedValue({
      deal: { id: 'deal-1', assignedTechIds: ['someone-else'], contactId: 'contact-1' },
      items: [],
      totals: {} as any,
    });
    const tech = caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' });
    await expect(service.recordOffline('deal-1', { amount: 10, method: 'cash' }, tech)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('works with no Stripe keys at all', async () => {
    const { service } = build({ stripe: null });
    const p = await service.recordOffline('deal-1', { amount: 10, method: 'cash' }, caller());
    expect(p.status).toBe('settled');
  });
});

describe('PaymentsService — client invoices (no job)', () => {
  const clientInvoice = () => invoice({ id: 'inv-c1', number: '1001', dealId: undefined });

  it('reads an (empty) ledger for a client invoice', async () => {
    const ledger = fakeLedger();
    const invoices = fakeInvoices(clientInvoice(), ledger);
    const service = new PaymentsService(ledger as any, invoices as any, new PaymentSettingsService(ledger as any), mockDealClient() as any);
    await expect(service.listForInvoice('inv-c1', caller())).resolves.toEqual({
      payments: [],
      summary: expect.objectContaining({ settled: 0, paymentCount: 0 }),
    });
  });

  it('is office-only: a technician scoped to their jobs gets 403', async () => {
    const ledger = fakeLedger();
    const invoices = fakeInvoices(clientInvoice(), ledger);
    const service = new PaymentsService(ledger as any, invoices as any, new PaymentSettingsService(ledger as any), mockDealClient() as any);
    await expect(service.listForInvoice('inv-c1', caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1' }))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('refuses to record a payment on it (409) until the ledger learns about invoices without a job', async () => {
    const ledger = fakeLedger();
    const invoices = fakeInvoices(clientInvoice(), ledger);
    const deal = mockDealClient();
    const service = new PaymentsService(ledger as any, invoices as any, new PaymentSettingsService(ledger as any), deal as any);
    await expect(service.recordOffline('inv-c1', { amount: 10, method: 'cash' }, caller())).rejects.toThrow(ConflictException);
    expect(ledger.payments.size).toBe(0);
    expect(deal.getBillingView).not.toHaveBeenCalled();
  });
});

describe('PaymentsService — deleting a payment', () => {
  it('removes a mis-keyed offline payment and re-derives the invoice', async () => {
    const ledger = fakeLedger([payment({ id: 'p-off', amount: 40, method: 'cash', source: 'office' })]);
    const { service, invoices } = build({ ledger });
    await service.remove('p-off', caller());
    expect(ledger.payments.size).toBe(0);
    expect(invoices.applyAmountPaid).toHaveBeenCalledWith('deal-1', 0);
  });

  it('refuses to delete a Stripe-backed payment — refund it instead', async () => {
    const ledger = fakeLedger([payment({ id: 'p-online', stripePaymentIntentId: 'pi_1' })]);
    const { service } = build({ ledger });
    await expect(service.remove('p-online', caller())).rejects.toThrow(ConflictException);
    expect(ledger.payments.size).toBe(1);
  });

  it('404s on an unknown payment', async () => {
    const { service } = build();
    await expect(service.remove('nope', caller())).rejects.toThrow(NotFoundException);
  });
});

describe('PaymentsService — refunds', () => {
  it('leaves the payment settled after a partial refund and raises refundedAmount', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', amount: 100, stripePaymentIntentId: 'pi_1' })]);
    const { service, stripe, invoices } = build({ ledger });

    const refund = await service.refund('p1', { amount: 30 }, caller());

    expect(refund.amount).toBe(30);
    expect(refund.status).toBe('succeeded');
    expect(stripe.createRefund).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_1', amount: 30 }));
    const after = ledger.payments.get('p1')!;
    expect(after.status).toBe('settled');
    expect(after.refundedAmount).toBe(30);
    // 100 taken, 30 back ⇒ 70 counts.
    expect(invoices.applyAmountPaid).toHaveBeenCalledWith('deal-1', 70);
  });

  it('marks the payment refunded when the whole amount goes back', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', amount: 100, stripePaymentIntentId: 'pi_1' })]);
    const { service, invoices } = build({ ledger });
    await service.refund('p1', {}, caller());
    expect(ledger.payments.get('p1')!.status).toBe('refunded');
    expect(ledger.payments.get('p1')!.refundedAmount).toBe(100);
    expect(invoices.applyAmountPaid).toHaveBeenCalledWith('deal-1', 0);
  });

  it('refuses to refund more than is left', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', amount: 100, refundedAmount: 80, stripePaymentIntentId: 'pi_1' })]);
    const { service, stripe } = build({ ledger });
    await expect(service.refund('p1', { amount: 20.01 }, caller())).rejects.toThrow(BadRequestException);
    expect(stripe.createRefund).not.toHaveBeenCalled();
  });

  it('refuses to refund money that never landed', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', status: 'pending', method: 'bank' })]);
    const { service } = build({ ledger });
    await expect(service.refund('p1', {}, caller())).rejects.toThrow(ConflictException);
  });

  it('refunds an offline payment as book-keeping only — no Stripe call', async () => {
    const ledger = fakeLedger([payment({ id: 'p-cash', amount: 60, method: 'cash', source: 'office' })]);
    const { service, stripe } = build({ ledger });
    const refund = await service.refund('p-cash', { amount: 60, reason: 'goodwill' }, caller());
    expect(stripe.createRefund).not.toHaveBeenCalled();
    expect(refund.status).toBe('succeeded');
    expect(refund.stripeRefundId).toBeUndefined();
    expect(ledger.payments.get('p-cash')!.status).toBe('refunded');
  });

  it('publishes payment.refunded and pushes the invoice back to due', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', amount: 100, method: 'cash', source: 'office' })]);
    const { service, events, invoices, deal } = build({ ledger });
    await service.refund('p1', {}, caller());
    expect(events.payment).toHaveBeenCalledWith(BillingEventType.PAYMENT_REFUNDED, expect.anything());
    expect(invoices.stored.status).toBe('due');
    expect(deal.setPaymentStatus).toHaveBeenCalledWith(
      'deal-1',
      expect.objectContaining({ paymentStatus: 'unpaid', amountPaid: 0 }),
    );
  });

  it('keeps the offline ledger refundable with no Stripe configured', async () => {
    const ledger = fakeLedger([payment({ id: 'p-cash', amount: 60, method: 'cash', source: 'office' })]);
    const { service } = build({ ledger, stripe: null });
    await expect(service.refund('p-cash', {}, caller())).resolves.toMatchObject({ amount: 60 });
  });
});

describe('PaymentsService — the invoice ledger read', () => {
  it('returns the rows newest first with their summary', async () => {
    const ledger = fakeLedger([
      payment({ id: 'a', amount: 60, takenAt: '2026-09-20T10:00:00.000Z', createdAt: '2026-09-20T10:00:00.000Z' }),
      payment({
        id: 'b',
        amount: 20,
        status: 'pending',
        method: 'bank',
        takenAt: '2026-09-21T10:00:00.000Z',
        createdAt: '2026-09-21T10:00:00.000Z',
      }),
    ]);
    const { service } = build({ ledger });
    const res = await service.listForInvoice('deal-1', caller());
    expect(res.payments.map((p) => p.id)).toEqual(['b', 'a']);
    expect(res.summary).toMatchObject({ settled: 60, pending: 20, hasPending: true, paymentCount: 2 });
  });
});

describe('PaymentSettingsService', () => {
  it('returns the defaults before anything is saved, and never a key', async () => {
    const ledger = fakeLedger();
    const settings = new PaymentSettingsService(ledger as any);
    const s = await settings.get();
    expect(s.onlinePaymentsEnabled).toBe(false);
    expect(s.surchargePercent).toBe(0);
    expect(JSON.stringify(s)).not.toMatch(/sk_|whsec_/);
  });

  it('validates the surcharge against the US card-network ceiling', async () => {
    const settings = new PaymentSettingsService(fakeLedger() as any);
    await expect(settings.update({ surchargePercent: MAX_SURCHARGE_PERCENT + 0.1 }, 'u-1')).rejects.toThrow(
      BadRequestException,
    );
    await expect(settings.update({ surchargePercent: -1 }, 'u-1')).rejects.toThrow(BadRequestException);
    await expect(settings.update({ surchargePercent: 3 }, 'u-1')).resolves.toMatchObject({ surchargePercent: 3 });
  });

  it('refuses a negative bank minimum', async () => {
    const settings = new PaymentSettingsService(fakeLedger() as any);
    await expect(settings.update({ bankMinimum: -5 }, 'u-1')).rejects.toThrow(BadRequestException);
  });

  it('merges a partial update and stamps who changed it', async () => {
    const settings = new PaymentSettingsService(fakeLedger() as any);
    await settings.update({ bankEnabled: true, bankMinimum: 25 }, 'u-9');
    const s = await settings.update({ allowPartial: false }, 'u-9');
    expect(s).toMatchObject({ bankEnabled: true, bankMinimum: 25, allowPartial: false, updatedBy: 'u-9' });
    expect(s.updatedAt).toBeTruthy();
  });
});

describe('PaymentsService — the payments report', () => {
  const rows = [
    payment({ id: 'a', amount: 60, status: 'settled', method: 'card' }),
    payment({ id: 'b', amount: 20, status: 'pending', method: 'bank' }),
    payment({ id: 'c', amount: 40, status: 'settled', method: 'cash', refundedAmount: 15 }),
    payment({ id: 'd', amount: 10, status: 'failed', method: 'card' }),
  ];

  it('summarises the whole filtered range, not just the page', async () => {
    const { service } = build({ ledger: fakeLedger(rows) });
    const page = await service.list({ limit: 1 }, caller());
    expect(page.items).toHaveLength(1);
    // 60 + (40 - 15); the pending 20 and the failed 10 are excluded.
    expect(page.summary).toMatchObject({ settled: 85, pending: 20, refunded: 15, paymentCount: 4 });
  });

  it('does not recompute the range summary for a follow-on page', async () => {
    const { service } = build({ ledger: fakeLedger(rows) });
    const page = await service.list({ limit: 1, cursor: 'abc' }, caller());
    expect(page.summary).toBeUndefined();
  });
});

describe('PaymentsService — receipts', () => {
  it('asks messaging to text the client, on the caller’s own bearer', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', amount: 40, method: 'cash', source: 'office' })]);
    const { service, messaging } = build({ ledger });
    const res = await service.sendReceipt('p1', caller(), 'Bearer abc');
    expect(res).toEqual({ sent: true, sentTo: '+18605550100' });
    expect(messaging.sendToContact).toHaveBeenCalledWith(
      expect.objectContaining({ contactId: 'contact-1', channel: 'sms', body: expect.stringContaining('K4T9ZW') }),
      'Bearer abc',
    );
  });

  it('falls back to email when the client has no number', async () => {
    const ledger = fakeLedger([payment({ id: 'p1' })]);
    const { service, crm, messaging } = build({ ledger });
    crm.getContact.mockResolvedValue({ id: 'contact-1', phones: [], emails: ['jane@example.com'] });
    const res = await service.sendReceipt('p1', caller(), 'Bearer abc');
    expect(res).toEqual({ sent: true, sentTo: 'jane@example.com' });
    expect(messaging.sendToContact).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'email', subject: expect.stringContaining('K4T9ZW') }),
      'Bearer abc',
    );
  });

  it('reports sent: false rather than failing when there is nowhere to send it', async () => {
    const ledger = fakeLedger([payment({ id: 'p1' })]);
    const { service, crm } = build({ ledger });
    crm.getContact.mockResolvedValue({ id: 'contact-1', phones: [], emails: [] });
    await expect(service.sendReceipt('p1', caller(), 'Bearer abc')).resolves.toEqual({ sent: false });
  });

  it('refuses to send a receipt for money that never landed', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', status: 'pending', method: 'bank' })]);
    const { service } = build({ ledger });
    await expect(service.sendReceipt('p1', caller(), 'Bearer abc')).rejects.toThrow(ConflictException);
  });
});

describe('PaymentSettingsService — what an invoice may be paid with', () => {
  const settings = () => new PaymentSettingsService(fakeLedger() as any);
  const on = { onlinePaymentsEnabled: true, cardEnabled: true, bankEnabled: true } as any;

  it('treats an EMPTY allowedMethods list as "no online payment on this invoice"', async () => {
    const s = settings();
    expect(s.methodsFor({ ...on }, [], true)).toEqual([]);
  });

  it('treats an ABSENT allowedMethods as "whatever the account allows"', async () => {
    const s = settings();
    expect(s.methodsFor({ ...on }, undefined, true)).toEqual(['card', 'bank']);
  });

  it('offers nothing without Stripe, whatever the document says', async () => {
    const s = settings();
    expect(s.methodsFor({ ...on }, ['card'], false)).toEqual([]);
  });
});
