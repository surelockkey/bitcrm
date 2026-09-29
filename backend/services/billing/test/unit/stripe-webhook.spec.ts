/* eslint-disable @typescript-eslint/no-explicit-any */
import { BillingEventType } from '@bitcrm/types';
import { StripeEventsHandler } from 'src/payments/stripe/stripe-events.handler';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { mockDealClient, mockEvents } from './mocks';
import { fakeInvoices, fakeLedger, invoice, mockStripeService, payment } from './payment-mocks';

let seq = 0;
const event = (type: string, object: any, over: Partial<any> = {}): any => ({
  id: `evt_${++seq}`,
  object: 'event',
  type,
  api_version: '2026-08-26.dahlia',
  created: Math.floor(Date.now() / 1000),
  livemode: false,
  data: { object },
  ...over,
});

function build(seed = [payment({ id: 'p1', status: 'pending', stripeSessionId: 'cs_1' })]) {
  const ledger = fakeLedger(seed);
  for (const p of seed) {
    if (p.stripeSessionId) ledger.pointers.set(p.stripeSessionId, p.id);
    if (p.stripePaymentIntentId) ledger.pointers.set(p.stripePaymentIntentId, p.id);
  }
  const invoices = fakeInvoices(invoice(), ledger);
  const settings = new PaymentSettingsService(ledger as any);
  const deal = mockDealClient();
  const stripe = mockStripeService();
  const events = mockEvents();
  const payments = new PaymentsService(
    ledger as any,
    invoices as any,
    settings as any,
    deal as any,
    stripe as any,
    events as any,
  );
  const handler = new StripeEventsHandler(ledger as any, payments, stripe as any);
  return { handler, ledger, invoices, deal, stripe, events, payments };
}

const status = (l: ReturnType<typeof fakeLedger>, id = 'p1') => l.payments.get(id)!.status;

const intent = (over: any = {}) => ({
  id: 'pi_1',
  object: 'payment_intent',
  status: 'succeeded',
  amount: 10_000,
  currency: 'usd',
  latest_charge: 'ch_1',
  metadata: { paymentId: 'p1', invoiceId: 'deal-1', dealId: 'deal-1', contactId: 'contact-1' },
  ...over,
});

const session = (over: any = {}) => ({
  id: 'cs_1',
  object: 'checkout.session',
  payment_status: 'paid',
  status: 'complete',
  payment_intent: 'pi_1',
  client_reference_id: 'deal-1',
  metadata: { paymentId: 'p1', invoiceId: 'deal-1', dealId: 'deal-1', contactId: 'contact-1' },
  ...over,
});

describe('stripe webhook — dedupe', () => {
  it('handles an event once; a replay changes nothing', async () => {
    const { handler, ledger, invoices } = build();
    const e = event('payment_intent.succeeded', intent());

    expect(await handler.receive(e)).toBe(true);
    await handler.settle();
    expect(status(ledger)).toBe('settled');
    const versionAfterFirst = ledger.payments.get('p1')!.version;
    invoices.applyAmountPaid.mockClear();

    expect(await handler.receive(e)).toBe(false);
    await handler.settle();
    expect(ledger.payments.get('p1')!.version).toBe(versionAfterFirst);
    expect(invoices.applyAmountPaid).not.toHaveBeenCalled();
  });

  it('releases the claim when the handler throws, so Stripe’s retry lands', async () => {
    const { handler, ledger } = build();
    ledger.update.mockRejectedValueOnce(new Error('dynamo is having a day'));
    const e = event('payment_intent.succeeded', intent());
    await handler.receive(e);
    await handler.settle();
    expect(ledger.claimed.has(e.id)).toBe(false);
    // The retry succeeds.
    await handler.receive(e);
    await handler.settle();
    expect(status(ledger)).toBe('settled');
  });

  it('ignores an event whose payment it cannot find', async () => {
    const { handler, ledger } = build([]);
    await handler.receive(event('payment_intent.succeeded', intent()));
    await handler.settle();
    expect(ledger.payments.size).toBe(0);
  });

  it('ignores an event type it does not subscribe to', async () => {
    const { handler, invoices } = build();
    await handler.receive(event('customer.created', { id: 'cus_1', object: 'customer' }));
    await handler.settle();
    expect(invoices.applyAmountPaid).not.toHaveBeenCalled();
  });
});

describe('stripe webhook — events arriving out of order never regress state', () => {
  it('leaves a reversed payment reversed when a late payment_intent.succeeded arrives', async () => {
    const { handler, ledger, events } = build([
      payment({ id: 'p1', status: 'settled', method: 'bank', stripePaymentIntentId: 'pi_1', stripeChargeId: 'ch_1' }),
    ]);
    await handler.receive(
      event('charge.dispute.created', {
        id: 'dp_1',
        object: 'dispute',
        charge: 'ch_1',
        payment_intent: 'pi_1',
        reason: 'insufficient_funds',
        status: 'needs_response',
      }),
    );
    await handler.settle();
    expect(status(ledger)).toBe('reversed');

    // Stripe keeps the intent `succeeded` forever, and may re-deliver it.
    await handler.receive(event('payment_intent.succeeded', intent()));
    await handler.settle();
    expect(status(ledger)).toBe('reversed');
    expect(events.payment).not.toHaveBeenCalledWith(BillingEventType.PAYMENT_SUCCEEDED, expect.anything());
  });

  it('does not un-settle a settled payment with a late `processing`', async () => {
    const { handler, ledger } = build([
      payment({ id: 'p1', status: 'settled', method: 'bank', stripePaymentIntentId: 'pi_1' }),
    ]);
    await handler.receive(event('payment_intent.processing', intent({ status: 'processing' })));
    await handler.settle();
    expect(status(ledger)).toBe('settled');
  });

  it('does not un-settle a settled payment with a late `payment_failed`', async () => {
    const { handler, ledger } = build([payment({ id: 'p1', status: 'settled', stripePaymentIntentId: 'pi_1' })]);
    await handler.receive(
      event('payment_intent.payment_failed', intent({ status: 'requires_payment_method', last_payment_error: { message: 'declined' } })),
    );
    await handler.settle();
    expect(status(ledger)).toBe('settled');
  });

  it('does not un-refund a refunded payment with a late success', async () => {
    const { handler, ledger } = build([
      payment({ id: 'p1', status: 'refunded', refundedAmount: 100, stripePaymentIntentId: 'pi_1' }),
    ]);
    await handler.receive(event('payment_intent.succeeded', intent()));
    await handler.settle();
    expect(status(ledger)).toBe('refunded');
  });

  it('lets a failed attempt still settle — the same intent can be retried', async () => {
    const { handler, ledger } = build([
      payment({ id: 'p1', status: 'failed', stripePaymentIntentId: 'pi_1', failureReason: 'card declined' }),
    ]);
    await handler.receive(event('payment_intent.succeeded', intent()));
    await handler.settle();
    expect(status(ledger)).toBe('settled');
    expect(ledger.payments.get('p1')!.failureReason).toBeUndefined();
  });
});

describe('stripe webhook — a card payment', () => {
  it('settles on checkout.session.completed and records the intent + card details', async () => {
    const { handler, ledger, invoices, deal, events } = build();
    await handler.receive(event('checkout.session.completed', session()));
    await handler.settle();

    const p = ledger.payments.get('p1')!;
    expect(p.status).toBe('settled');
    expect(p.settledAt).toBeTruthy();
    expect(p.stripePaymentIntentId).toBe('pi_1');
    expect(ledger.pointers.get('pi_1')).toBe('p1');
    expect(invoices.stored.status).toBe('paid');
    expect(deal.setPaymentStatus).toHaveBeenCalledWith('deal-1', expect.objectContaining({ paymentStatus: 'paid' }));
    expect(events.payment).toHaveBeenCalledWith(BillingEventType.PAYMENT_SUCCEEDED, expect.anything());
  });

  it('records the failure reason a dispatcher can act on', async () => {
    const { handler, ledger, events } = build();
    await handler.receive(
      event(
        'payment_intent.payment_failed',
        intent({
          status: 'requires_payment_method',
          last_payment_error: { message: 'Your card was declined.', code: 'card_declined' },
        }),
      ),
    );
    await handler.settle();
    expect(status(ledger)).toBe('failed');
    expect(ledger.payments.get('p1')!.failureReason).toBe('Your card was declined.');
    expect(events.payment).toHaveBeenCalledWith(BillingEventType.PAYMENT_FAILED, expect.anything());
  });
});

describe('stripe webhook — ACH (bank) is the whole reason `reversed` exists', () => {
  const ach = () => [payment({ id: 'p1', status: 'pending', method: 'bank', stripeSessionId: 'cs_1', amount: 100 })];

  it('stays pending when the session completes but the money has not moved', async () => {
    const { handler, ledger, invoices } = build(ach());
    await handler.receive(event('checkout.session.completed', session({ payment_status: 'unpaid' })));
    await handler.settle();
    expect(status(ledger)).toBe('pending');
    // Pending money never counts toward the invoice.
    expect(invoices.stored.status).toBe('due');
    expect(invoices.stored.totals.balanceDue).toBe(100);
    // But the confirmation is recorded, so this attempt can no longer be superseded.
    expect(ledger.payments.get('p1')!.stripePaymentIntentId).toBe('pi_1');
  });

  it('marks it pending on payment_intent.processing', async () => {
    const { handler, ledger, events } = build(ach());
    await handler.receive(event('payment_intent.processing', intent({ status: 'processing' })));
    await handler.settle();
    expect(status(ledger)).toBe('pending');
    expect(events.payment).toHaveBeenCalledWith(BillingEventType.PAYMENT_PENDING, expect.anything());
  });

  it('settles it days later on async_payment_succeeded', async () => {
    const { handler, ledger, invoices } = build(ach());
    await handler.receive(event('checkout.session.completed', session({ payment_status: 'unpaid' })));
    await handler.settle();
    await handler.receive(event('checkout.session.async_payment_succeeded', session({ payment_status: 'paid' })));
    await handler.settle();
    expect(status(ledger)).toBe('settled');
    expect(invoices.stored.status).toBe('paid');
  });

  it('fails it on async_payment_failed and leaves the invoice owing', async () => {
    const { handler, ledger, invoices } = build(ach());
    await handler.receive(event('checkout.session.async_payment_failed', session({ payment_status: 'unpaid' })));
    await handler.settle();
    expect(status(ledger)).toBe('failed');
    expect(invoices.stored.status).toBe('due');
  });

  it('REVERSES a settled ACH payment when the bank pulls it back as a dispute', async () => {
    const { handler, ledger, invoices, deal, events } = build(ach());
    await handler.receive(event('checkout.session.completed', session({ payment_status: 'paid' })));
    await handler.settle();
    expect(status(ledger)).toBe('settled');
    expect(invoices.stored.status).toBe('paid');

    // The PaymentIntent stays `succeeded`. Only this tells us the money left.
    await handler.receive(
      event('charge.dispute.created', {
        id: 'dp_1',
        object: 'dispute',
        charge: 'ch_1',
        payment_intent: 'pi_1',
        reason: 'insufficient_funds',
        status: 'needs_response',
        amount: 10_000,
      }),
    );
    await handler.settle();

    const p = ledger.payments.get('p1')!;
    expect(p.status).toBe('reversed');
    expect(p.reversedAt).toBeTruthy();
    expect(p.failureReason).toMatch(/insufficient funds/i);
    expect(invoices.stored.status).toBe('due');
    expect(invoices.stored.totals.balanceDue).toBe(100);
    expect(deal.setPaymentStatus).toHaveBeenLastCalledWith(
      'deal-1',
      expect.objectContaining({ paymentStatus: 'unpaid', amountPaid: 0 }),
    );
    expect(events.payment).toHaveBeenCalledWith(BillingEventType.PAYMENT_REVERSED, expect.anything());
  });

  it('restores a reversed payment when the dispute is won', async () => {
    const { handler, ledger, invoices } = build([
      payment({
        id: 'p1',
        status: 'reversed',
        method: 'bank',
        stripePaymentIntentId: 'pi_1',
        stripeChargeId: 'ch_1',
        reversedAt: '2026-09-23T00:00:00.000Z',
      }),
    ]);
    await handler.receive(
      event('charge.dispute.closed', {
        id: 'dp_1',
        object: 'dispute',
        charge: 'ch_1',
        payment_intent: 'pi_1',
        reason: 'insufficient_funds',
        status: 'won',
      }),
    );
    await handler.settle();
    expect(status(ledger)).toBe('settled');
    expect(invoices.stored.status).toBe('paid');
  });

  it('keeps it reversed when the dispute is lost', async () => {
    const { handler, ledger } = build([
      payment({ id: 'p1', status: 'settled', method: 'bank', stripePaymentIntentId: 'pi_1', stripeChargeId: 'ch_1' }),
    ]);
    await handler.receive(
      event('charge.dispute.closed', {
        id: 'dp_1',
        object: 'dispute',
        charge: 'ch_1',
        payment_intent: 'pi_1',
        reason: 'fraudulent',
        status: 'lost',
      }),
    );
    await handler.settle();
    expect(status(ledger)).toBe('reversed');
  });
});

describe('stripe webhook — refunds initiated at Stripe', () => {
  it('mirrors charge.refunded into the ledger', async () => {
    const { handler, ledger, invoices } = build([
      payment({ id: 'p1', status: 'settled', amount: 100, stripePaymentIntentId: 'pi_1', stripeChargeId: 'ch_1' }),
    ]);
    await handler.receive(
      event('charge.refunded', {
        id: 'ch_1',
        object: 'charge',
        payment_intent: 'pi_1',
        amount: 10_000,
        amount_refunded: 4_000,
        refunded: false,
      }),
    );
    await handler.settle();
    const p = ledger.payments.get('p1')!;
    expect(p.refundedAmount).toBe(40);
    expect(p.status).toBe('settled');
    expect(invoices.applyAmountPaid).toHaveBeenCalledWith('deal-1', 60);
  });

  it('marks a fully refunded charge `refunded`', async () => {
    const { handler, ledger } = build([
      payment({ id: 'p1', status: 'settled', amount: 100, stripePaymentIntentId: 'pi_1', stripeChargeId: 'ch_1' }),
    ]);
    await handler.receive(
      event('charge.refunded', {
        id: 'ch_1',
        object: 'charge',
        payment_intent: 'pi_1',
        amount: 10_000,
        amount_refunded: 10_000,
        refunded: true,
      }),
    );
    await handler.settle();
    expect(ledger.payments.get('p1')!.status).toBe('refunded');
  });

  it('asserts the refunded TOTAL rather than adding to it, so a replay is harmless', async () => {
    const { handler, ledger } = build([
      payment({ id: 'p1', status: 'settled', amount: 100, stripePaymentIntentId: 'pi_1', stripeChargeId: 'ch_1' }),
    ]);
    const charge = {
      id: 'ch_1',
      object: 'charge',
      payment_intent: 'pi_1',
      amount: 10_000,
      amount_refunded: 3_000,
      refunded: false,
    };
    await handler.receive(event('charge.refunded', charge));
    await handler.settle();
    // A different event id carrying the same state — Stripe does that.
    await handler.receive(event('charge.refunded', charge));
    await handler.settle();
    expect(ledger.payments.get('p1')!.refundedAmount).toBe(30);
  });
});
