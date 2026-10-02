/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Payment } from '@bitcrm/types';
import { PaymentReconcileScheduler } from 'src/payments/payment-reconcile.scheduler';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { StripeEventsHandler } from 'src/payments/stripe/stripe-events.handler';
import { mockDealClient, mockEvents } from './mocks';
import { PAY_NOW, fakeInvoices, fakeLedger, invoice, mockStripeService, payment } from './payment-mocks';

/** Half an hour after the rows below were last touched — past the sweep's 20-minute age. */
const LATER = Date.parse(PAY_NOW) + 30 * 60_000;

/** A typed card left in the ledger (pending, intent recorded, no charge yet). */
const typed = (over: Partial<Payment> = {}): Payment =>
  payment({
    id: 'kd-1',
    status: 'pending',
    source: 'field',
    takenBy: 'tech-1',
    channel: 'keyed',
    transactionMethod: 'Keyed',
    amount: 60,
    stripePaymentIntentId: 'pi_kd1',
    ...over,
  });

const intent = (over: any = {}) => ({
  id: 'pi_kd1',
  object: 'payment_intent',
  status: 'requires_action',
  latest_charge: null,
  metadata: { paymentId: 'kd-1', dealId: 'deal-1', channel: 'keyed' },
  ...over,
});

function build(seed: Payment[]) {
  const ledger = fakeLedger(seed);
  for (const p of seed) if (p.stripePaymentIntentId) ledger.pointers.set(p.stripePaymentIntentId, p.id);
  const invoices = fakeInvoices(invoice(), ledger);
  const settings = new PaymentSettingsService(ledger as any);
  const stripe = mockStripeService();
  const payments = new PaymentsService(ledger as any, invoices as any, settings, mockDealClient() as any, stripe as any, mockEvents() as any);
  const handler = new StripeEventsHandler(ledger as any, payments, stripe as any);
  const redis = { client: { set: jest.fn(async () => 'OK') } };
  const sweep = new PaymentReconcileScheduler(ledger as any, handler, stripe as any, redis as any);
  return { sweep, ledger, stripe, invoices };
}

describe('the reconciliation sweep — cards typed in on a phone (keyed)', () => {
  it('settles a typed card whose success never reached us, from what Stripe says', async () => {
    const { sweep, ledger, stripe, invoices } = build([typed()]);
    stripe.retrievePaymentIntent.mockResolvedValue(intent({ status: 'succeeded', latest_charge: 'ch_kd1' }));
    await expect(sweep.sweep(LATER)).resolves.toBe(1);
    expect(ledger.payments.get('kd-1')).toMatchObject({ status: 'settled', stripeChargeId: 'ch_kd1' });
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 60);
  });

  it('fails a typed card Stripe declined (or whose 3-D Secure step failed)', async () => {
    const { sweep, ledger, stripe } = build([typed()]);
    stripe.retrievePaymentIntent.mockResolvedValue(
      intent({ status: 'requires_payment_method', last_payment_error: { type: 'card_error', message: 'Your card was declined.' } }),
    );
    await sweep.sweep(LATER);
    expect(ledger.payments.get('kd-1')).toMatchObject({ status: 'failed', failureReason: 'Your card was declined.' });
  });

  it('cancels at Stripe — so it can never be charged later — and fails a typed card whose 3-D Secure step was never finished', async () => {
    const { sweep, ledger, stripe } = build([typed()]);
    stripe.retrievePaymentIntent.mockResolvedValue(intent({ status: 'requires_action' }));
    stripe.cancelPaymentIntent.mockResolvedValue(intent({ status: 'canceled', cancellation_reason: 'abandoned' }));
    await expect(sweep.sweep(LATER)).resolves.toBe(1);
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_kd1', 'abandoned');
    expect(ledger.payments.get('kd-1')).toMatchObject({ status: 'failed', failureReason: 'The payment was cancelled (abandoned)' });
  });

  it('settles instead when the 3-D Secure step finished just as the sweep tried to cancel it', async () => {
    const { sweep, ledger, stripe } = build([typed()]);
    stripe.retrievePaymentIntent
      .mockResolvedValueOnce(intent({ status: 'requires_action' }))
      .mockResolvedValue(intent({ status: 'succeeded', latest_charge: 'ch_kd1' }));
    stripe.cancelPaymentIntent.mockRejectedValueOnce(new Error('This PaymentIntent has already succeeded'));
    await sweep.sweep(LATER);
    expect(ledger.payments.get('kd-1')!.status).toBe('settled');
  });

  it('leaves a typed card that is still young alone — the client may be on the 3-D Secure screen right now', async () => {
    const { sweep, ledger, stripe } = build([typed({ updatedAt: new Date(LATER - 5 * 60_000).toISOString() })]);
    await expect(sweep.sweep(LATER)).resolves.toBe(0);
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(ledger.payments.get('kd-1')!.status).toBe('pending');
  });

  it('never cancels a Tap to Pay attempt for waiting on the device — only typed cards wait on 3-D Secure', async () => {
    const { sweep, ledger, stripe } = build([typed({ channel: 'terminal', transactionMethod: 'Tap to Pay' })]);
    stripe.retrievePaymentIntent.mockResolvedValue(intent({ status: 'requires_action' }));
    await sweep.sweep(LATER);
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalled();
    expect(ledger.payments.get('kd-1')!.status).toBe('pending');
  });
});
