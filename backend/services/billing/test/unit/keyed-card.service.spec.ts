/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { BillingEventType, type Estimate, type Payment } from '@bitcrm/types';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { StripeEventsHandler } from 'src/payments/stripe/stripe-events.handler';
import { TerminalService } from 'src/payments/terminal/terminal.service';
import { DataScope, billingView, caller, dealProduct, mockDealClient, mockEvents, profile } from './mocks';
import { PAY_NOW, fakeInvoices, fakeLedger, invoice, mockStripeService, payment } from './payment-mocks';

/**
 * "Type card manually" (Workiz "Credit card payment"): the technician types
 * the client's card on the phone, @stripe/stripe-react-native turns it into a
 * `pm_…`, and billing creates AND confirms a `card` PaymentIntent with it —
 * the same attempt rules as Tap to Pay, a different Stripe call.
 */

const SIGNED = '2026-09-22T11:00:00.000Z';
const ATTEMPT = '0b9c6d2e-4f1a-4c3b-9d8e-7a6b5c4d3e2f';
const OTHER_ATTEMPT = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
const PM = 'pm_card_visa';

const tech = () => caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1', email: 'tech@example.com' });

const estimate = (over: Partial<Estimate> = {}): Estimate =>
  ({
    id: 'est-1',
    number: 'K4T9ZW-1',
    dealId: 'deal-1',
    dealNumber: 'K4T9ZW',
    contactId: 'contact-1',
    status: 'pending',
    estimateDate: '2026-09-20',
    totals: { subtotal: 200, discount: 0, taxRatePercent: 0, tax: 0, total: 200, amountPaid: 0, balanceDue: 200 },
    depositPercentage: 50,
    signedAt: SIGNED,
    version: 1,
    createdBy: 'u-1',
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
    ...over,
  }) as Estimate;

/** A Stripe PaymentIntent as `paymentIntents.create` (confirm: true) answers it. */
const pi = (over: any = {}) => ({
  id: 'pi_k',
  object: 'payment_intent',
  client_secret: 'pi_k_secret_1',
  status: 'requires_action',
  latest_charge: null,
  metadata: { paymentId: ATTEMPT, invoiceId: 'deal-1', dealId: 'deal-1', contactId: 'contact-1', channel: 'keyed' },
  ...over,
});

/** The charge that paid, expanded on the intent. */
const charge = (over: any = {}) => ({
  id: 'ch_k',
  object: 'charge',
  payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } },
  ...over,
});

/** What stripe-node throws for a decline: a StripeCardError carrying the intent it was declined on. */
const cardError = (over: any = {}) =>
  Object.assign(new Error('Your card was declined.'), {
    type: 'StripeCardError',
    rawType: 'card_error',
    statusCode: 402,
    code: 'card_declined',
    decline_code: 'generic_decline',
    charge: 'ch_dec',
    payment_intent: pi({
      id: 'pi_dec',
      client_secret: 'pi_dec_secret_1',
      status: 'requires_payment_method',
      latest_charge: 'ch_dec',
      last_payment_error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' },
    }),
    ...over,
  });

/** A typed-card attempt already in the ledger (3-D Secure pending). */
const keyedRow = (over: Partial<Payment> = {}): Payment =>
  payment({
    id: 'kd-old',
    status: 'pending',
    source: 'field',
    takenBy: 'tech-1',
    channel: 'keyed',
    transactionMethod: 'Keyed',
    amount: 60,
    stripePaymentIntentId: 'pi_kold',
    createdAt: PAY_NOW,
    ...over,
  });

function build(
  over: {
    ledger?: ReturnType<typeof fakeLedger>;
    stripe?: ReturnType<typeof mockStripeService>;
    invoice?: ReturnType<typeof invoice>;
    estimate?: Estimate | null;
  } = {},
) {
  const ledger = over.ledger ?? fakeLedger();
  for (const p of ledger.payments.values()) if (p.stripePaymentIntentId) ledger.pointers.set(p.stripePaymentIntentId, p.id);
  const invoices = fakeInvoices(over.invoice ?? invoice({ signedAt: SIGNED }), ledger);
  const settings = new PaymentSettingsService(ledger as any);
  const deal = mockDealClient();
  deal.getBillingView.mockResolvedValue(billingView({}, [dealProduct({ quantity: 1, priceClient: 100, taxable: false })]));
  const stripe = over.stripe ?? mockStripeService();
  const events = mockEvents();
  const payments = new PaymentsService(ledger as any, invoices as any, settings, deal as any, stripe as any, events as any);
  const handler = new StripeEventsHandler(ledger as any, payments, stripe as any);
  const est = over.estimate === undefined ? estimate() : over.estimate;
  const estimates = { getStored: jest.fn(async (id: string) => (est && est.id === id ? { ...est } : null)) };
  const profiles = { getDefault: jest.fn(async () => profile()) };
  const signatures = { hasAny: jest.fn(async (_kind: string, _id: string) => false) };
  const service = new TerminalService(
    ledger as any,
    payments,
    settings,
    deal as any,
    stripe as any,
    handler,
    estimates as any,
    profiles as any,
    signatures as any,
  );
  return { service, ledger, invoices, settings, deal, stripe, events, payments, handler, estimates, signatures };
}

describe('Keyed card — the job’s invoice (POST /invoices/:id/card-intent)', () => {
  it('writes the pending row FIRST, then creates AND confirms a card intent with the phone’s PaymentMethod', async () => {
    const { service, ledger, stripe, invoices } = build();
    let rowFirst = false;
    stripe.createKeyedIntent.mockImplementationOnce(async (input: any) => {
      rowFirst = ledger.payments.get(input.metadata.paymentId)?.status === 'pending';
      return pi();
    });

    const res = await service.openCardForInvoice('deal-1', { amount: 60, tipAmount: 9, attemptId: ATTEMPT, paymentMethodId: PM }, tech());

    expect(rowFirst).toBe(true);
    expect(stripe.createKeyedIntent).toHaveBeenCalledWith({
      amount: 60,
      tipAmount: 9,
      feeAmount: 0,
      currency: 'usd',
      paymentMethodId: PM,
      description: 'Invoice K4T9ZW',
      metadata: {
        paymentId: ATTEMPT,
        invoiceId: 'deal-1',
        dealId: 'deal-1',
        contactId: 'contact-1',
        channel: 'keyed',
        env: expect.any(String),
      },
      idempotencyKey: `keyed_${ATTEMPT}`,
    });
    // 3-D Secure: the phone runs handleNextAction(clientSecret), then …/sync.
    expect(res).toEqual({
      paymentId: ATTEMPT,
      intentId: 'pi_k',
      clientSecret: 'pi_k_secret_1',
      status: 'requires_action',
      amount: 60,
      tipAmount: 9,
      feeAmount: 0,
      total: 69,
      currency: 'usd',
    });
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({
      invoiceId: 'deal-1',
      dealId: 'deal-1',
      contactId: 'contact-1',
      amount: 60,
      tipAmount: 9,
      method: 'card',
      channel: 'keyed',
      transactionMethod: 'Keyed',
      status: 'pending',
      source: 'field',
      takenBy: 'tech-1',
      technicianId: 'tech-1',
      stripePaymentIntentId: 'pi_k',
    });
    expect(ledger.pointers.get('pi_k')).toBe(ATTEMPT);
    expect(invoices.applyAmountPaid).not.toHaveBeenCalled();
  });

  it('settles the row at once when Stripe answers succeeded — asserted from the intent, with the card that paid', async () => {
    const { service, ledger, stripe, invoices, events } = build();
    stripe.createKeyedIntent.mockResolvedValueOnce(pi({ status: 'succeeded', latest_charge: charge() }));

    const res = await service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech());

    expect(res).toMatchObject({ paymentId: ATTEMPT, intentId: 'pi_k', status: 'succeeded', amount: 60, total: 60 });
    expect(res.declineMessage).toBeUndefined();
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({
      status: 'settled',
      stripePaymentIntentId: 'pi_k',
      stripeChargeId: 'ch_k',
      cardBrand: 'visa',
      last4: '4242',
    });
    expect(ledger.payments.get(ATTEMPT)!.settledAt).toBeTruthy();
    expect(ledger.pointers.get('ch_k')).toBe(ATTEMPT);
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 60);
    expect(events.payment).toHaveBeenCalledWith(BillingEventType.PAYMENT_SUCCEEDED, expect.objectContaining({ paymentId: ATTEMPT }));

    // The webhook landing later (or the phone's sync) changes nothing.
    const version = ledger.payments.get(ATTEMPT)!.version;
    stripe.retrievePaymentIntent.mockResolvedValue(pi({ status: 'succeeded', latest_charge: charge() }));
    await service.sync(ATTEMPT, tech());
    expect(ledger.payments.get(ATTEMPT)!.version).toBe(version);
  });

  it('a declined card fails the attempt with the bank’s words and answers 200 requires_payment_method + declineMessage', async () => {
    const { service, ledger, stripe, events, invoices } = build();
    stripe.createKeyedIntent.mockRejectedValueOnce(cardError());

    const res = await service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech());

    expect(res).toEqual({
      paymentId: ATTEMPT,
      intentId: 'pi_dec',
      clientSecret: 'pi_dec_secret_1',
      status: 'requires_payment_method',
      amount: 60,
      tipAmount: 0,
      feeAmount: 0,
      total: 60,
      currency: 'usd',
      declineMessage: 'Your card was declined.',
    });
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({
      status: 'failed',
      failureReason: 'Your card was declined.',
      stripePaymentIntentId: 'pi_dec',
      stripeChargeId: 'ch_dec',
    });
    expect(ledger.pointers.get('pi_dec')).toBe(ATTEMPT);
    expect(events.payment).toHaveBeenCalledWith(BillingEventType.PAYMENT_FAILED, expect.objectContaining({ paymentId: ATTEMPT }));

    // The same POST again (the phone never saw the answer): the same decline, no second charge.
    stripe.retrievePaymentIntent.mockResolvedValue(cardError().payment_intent);
    const again = await service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech());
    expect(again).toEqual(res);
    expect(stripe.createKeyedIntent).toHaveBeenCalledTimes(1);

    // Another card is a NEW attempt — the declined one caps nothing.
    stripe.createKeyedIntent.mockResolvedValueOnce(
      pi({ id: 'pi_k2', status: 'succeeded', metadata: { paymentId: OTHER_ATTEMPT }, latest_charge: charge({ id: 'ch_k2' }) }),
    );
    await expect(
      service.openCardForInvoice('deal-1', { amount: 100, attemptId: OTHER_ATTEMPT, paymentMethodId: 'pm_card_mastercard' }, tech()),
    ).resolves.toMatchObject({ status: 'succeeded', amount: 100 });
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 100);
  });

  it('a PaymentMethod Stripe will not use on the intent it made is a refusal too — 200 with Stripe’s words', async () => {
    const { service, ledger, stripe } = build();
    stripe.createKeyedIntent.mockRejectedValueOnce(
      Object.assign(new Error('This PaymentMethod was previously used without being attached to a Customer.'), {
        type: 'StripeInvalidRequestError',
        rawType: 'invalid_request_error',
        statusCode: 400,
        payment_intent: pi({ id: 'pi_used', status: 'requires_payment_method', last_payment_error: null }),
      }),
    );
    const res = await service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech());
    expect(res).toMatchObject({
      status: 'requires_payment_method',
      intentId: 'pi_used',
      declineMessage: 'This PaymentMethod was previously used without being attached to a Customer.',
    });
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({
      status: 'failed',
      failureReason: 'This PaymentMethod was previously used without being attached to a Customer.',
    });
  });

  it('a request Stripe refused before any intent existed charged nothing: no row, 400 with Stripe’s words', async () => {
    const { service, ledger, stripe } = build();
    stripe.createKeyedIntent.mockRejectedValueOnce(
      Object.assign(new Error("No such PaymentMethod: 'pm_bad'"), {
        type: 'StripeInvalidRequestError',
        rawType: 'invalid_request_error',
        statusCode: 400,
      }),
    );
    const err = await service
      .openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: 'pm_bad' }, tech())
      .catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe("No such PaymentMethod: 'pm_bad'");
    expect(ledger.payments.size).toBe(0);
  });

  it('when Stripe does not answer the row is kept (failed — it caps nothing) and the same attemptId asks Stripe again', async () => {
    const { service, ledger, stripe, invoices } = build();
    stripe.createKeyedIntent.mockRejectedValueOnce(
      Object.assign(new Error('An error occurred with our connection to Stripe.'), { type: 'StripeConnectionError' }),
    );
    await expect(
      service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({ status: 'failed' });
    expect(ledger.payments.get(ATTEMPT)!.stripePaymentIntentId).toBeUndefined();

    // The retry: the same idempotency key — Stripe answers what it did (here: it charged the card).
    stripe.createKeyedIntent.mockResolvedValueOnce(pi({ status: 'succeeded', latest_charge: charge() }));
    await expect(
      service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(stripe.createKeyedIntent).toHaveBeenCalledTimes(2);
    expect(stripe.createKeyedIntent.mock.calls[1][0].idempotencyKey).toBe(`keyed_${ATTEMPT}`);
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({ status: 'settled', stripePaymentIntentId: 'pi_k' });
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 60);
  });

  it('is idempotent on attemptId: a retry while 3-D Secure is pending answers the same intent, without a second charge', async () => {
    const { service, ledger, stripe } = build();
    stripe.createKeyedIntent.mockResolvedValueOnce(pi());
    const first = await service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech());
    stripe.retrievePaymentIntent.mockResolvedValue(pi());
    const again = await service.openCardForInvoice(
      'deal-1',
      { amount: 60, attemptId: ATTEMPT.toUpperCase(), paymentMethodId: PM },
      tech(),
    );
    expect(again).toEqual(first);
    expect(stripe.createKeyedIntent).toHaveBeenCalledTimes(1);
    expect(ledger.payments.size).toBe(1);

    // The 3-D Secure step finished at Stripe before its webhook got here: the retry answers settled.
    stripe.retrievePaymentIntent.mockResolvedValue(pi({ status: 'succeeded', latest_charge: charge() }));
    await expect(
      service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(ledger.payments.get(ATTEMPT)!.status).toBe('settled');
  });

  it('refuses an attemptId re-used for another amount, document, user — or across Tap to Pay and a typed card (409)', async () => {
    const { service, stripe } = build();
    stripe.createKeyedIntent.mockResolvedValue(pi());
    await service.openCardForInvoice('deal-1', { amount: 60, tipAmount: 5, attemptId: ATTEMPT, paymentMethodId: PM }, tech());
    for (const call of [
      () => service.openCardForInvoice('deal-1', { amount: 61, tipAmount: 5, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
      () => service.openCardForInvoice('deal-1', { amount: 60, tipAmount: 6, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
      () => service.openCardForEstimate('est-1', { amount: 60, tipAmount: 5, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
      () =>
        service.openCardForInvoice(
          'deal-1',
          { amount: 60, tipAmount: 5, attemptId: ATTEMPT, paymentMethodId: PM },
          caller(DataScope.ALL, { id: 'u-9' }),
        ),
      () => service.openForInvoice('deal-1', { amount: 60, tipAmount: 5, attemptId: ATTEMPT }, tech()),
    ]) {
      await expect(call()).rejects.toThrow(ConflictException);
    }

    const tapped = build();
    await tapped.service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech());
    await expect(
      tapped.service.openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(ConflictException);
  });

  it('signature first: 409 "A signature is required before payment" — nothing written, Stripe never called', async () => {
    const { service, ledger, stripe, signatures } = build({ invoice: invoice({ signedAt: undefined }) });
    const err = await service
      .openCardForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech())
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('A signature is required before payment');
    expect(signatures.hasAny).toHaveBeenCalledWith('invoice', 'deal-1');
    expect(ledger.payments.size).toBe(0);
    expect(stripe.createKeyedIntent).not.toHaveBeenCalled();
  });

  it('clamps like recording a payment and refuses what the phone got wrong — writing nothing', async () => {
    const { service, ledger, stripe } = build();
    for (const body of [
      { amount: 100.01, attemptId: ATTEMPT, paymentMethodId: PM },
      { amount: 0, attemptId: ATTEMPT, paymentMethodId: PM },
      { amount: 40, tipAmount: -1, attemptId: ATTEMPT, paymentMethodId: PM },
      { amount: 40, attemptId: 'not-a-uuid', paymentMethodId: PM },
      { amount: 40, attemptId: ATTEMPT, paymentMethodId: '4242424242424242' },
      { amount: 40, attemptId: ATTEMPT, paymentMethodId: '' },
    ]) {
      await expect(service.openCardForInvoice('deal-1', body as any, tech())).rejects.toThrow(BadRequestException);
    }
    expect(ledger.payments.size).toBe(0);
    expect(stripe.createKeyedIntent).not.toHaveBeenCalled();

    const paid = build({ ledger: fakeLedger([payment({ id: 'cash', amount: 100, method: 'cash', source: 'office' })]) });
    await expect(
      paid.service.openCardForInvoice('deal-1', { amount: 10, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(/nothing left to pay/i);
  });

  it('refuses a client invoice (409), a technician off the job (403), an unknown invoice (404), no Stripe (503)', async () => {
    const client = build({ invoice: invoice({ id: 'inv-c1', dealId: undefined, signedAt: SIGNED }) });
    await expect(
      client.service.openCardForInvoice('inv-c1', { amount: 10, attemptId: ATTEMPT, paymentMethodId: PM }, caller()),
    ).rejects.toThrow(ConflictException);

    const off = build();
    off.deal.getBillingView.mockResolvedValue(billingView({ assignedTechIds: ['someone-else'] }));
    await expect(
      off.service.openCardForInvoice('deal-1', { amount: 10, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(ForbiddenException);

    const missing = build();
    await expect(
      missing.service.openCardForInvoice('nope', { amount: 10, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(NotFoundException);

    const offline = build({ stripe: mockStripeService({ available: false }) });
    await expect(
      offline.service.openCardForInvoice('deal-1', { amount: 10, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(ServiceUnavailableException);
    for (const b of [client, off, missing, offline]) {
      expect(b.ledger.payments.size).toBe(0);
      expect(b.stripe.createKeyedIntent).not.toHaveBeenCalled();
    }
  });

  it('adds the service fee — surchargePercent of amount + tip — to the charge, the row and the answer, never to the balance', async () => {
    const { service, ledger, stripe, settings, invoices } = build();
    await settings.update({ surchargePercent: 3 }, 'u-1');
    stripe.createKeyedIntent.mockResolvedValueOnce(pi({ status: 'succeeded', latest_charge: charge() }));

    const res = await service.openCardForInvoice('deal-1', { amount: 60, tipAmount: 9, attemptId: ATTEMPT, paymentMethodId: PM }, tech());

    expect(res).toMatchObject({ amount: 60, tipAmount: 9, feeAmount: 2.07, total: 71.07, status: 'succeeded' });
    expect(stripe.createKeyedIntent).toHaveBeenCalledWith(expect.objectContaining({ amount: 60, tipAmount: 9, feeAmount: 2.07 }));
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({ status: 'settled', feeAmount: 2.07, tipAmount: 9 });
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 60);
  });

  it('replaces the caller’s own unfinished attempt — typed or tapped — cancelling it at Stripe first', async () => {
    const ledger = fakeLedger([
      keyedRow({ id: 'kd-mine', stripePaymentIntentId: 'pi_kmine' }),
      keyedRow({ id: 'tp-mine', channel: 'terminal', transactionMethod: 'Tap to Pay', stripePaymentIntentId: 'pi_tmine', amount: 20 }),
      keyedRow({ id: 'kd-theirs', takenBy: 'tech-2', stripePaymentIntentId: 'pi_ktheirs', amount: 30 }),
    ]);
    const { service, stripe } = build({ ledger });
    stripe.createKeyedIntent.mockResolvedValueOnce(pi());

    // $100 owed, $30 of it in another technician's hands ⇒ at most $70 here.
    await expect(
      service.openCardForInvoice('deal-1', { amount: 70, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).resolves.toMatchObject({ amount: 70 });
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_kmine', 'abandoned');
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_tmine', 'abandoned');
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalledWith('pi_ktheirs', expect.anything());
    expect(ledger.payments.get('kd-mine')).toMatchObject({ status: 'failed', failureReason: 'Replaced by a newer payment attempt' });
    expect(ledger.payments.get('tp-mine')).toMatchObject({ status: 'failed', failureReason: 'Replaced by a newer payment attempt' });
    expect(ledger.payments.get('kd-theirs')!.status).toBe('pending');
  });
});

describe('Keyed card — an estimate’s deposit (POST /estimates/:id/card-intent)', () => {
  it('takes it on the JOB’s ledger, tagged with the estimate, against what is still owed of the deposit', async () => {
    const ledger = fakeLedger([payment({ id: 'dep-1', estimateId: 'est-1', amount: 40, method: 'cash', source: 'office' })]);
    const { service, stripe } = build({ ledger });
    stripe.createKeyedIntent.mockResolvedValue(pi());

    // $100 deposit, $40 already paid ⇒ $60 left.
    await expect(
      service.openCardForEstimate('est-1', { amount: 61, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.openCardForEstimate('est-1', { amount: 60, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).resolves.toMatchObject({ paymentId: ATTEMPT, amount: 60, status: 'requires_action' });
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({ dealId: 'deal-1', invoiceId: 'deal-1', estimateId: 'est-1', channel: 'keyed' });
    const input = stripe.createKeyedIntent.mock.calls[0][0];
    expect(input).toMatchObject({
      description: 'Deposit for estimate K4T9ZW-1',
      metadata: expect.objectContaining({ paymentId: ATTEMPT, estimateId: 'est-1', dealId: 'deal-1', channel: 'keyed' }),
    });
    expect(input.metadata.invoiceId).toBeUndefined();
  });

  it('refuses: unsigned (409), no deposit asked (400), a client estimate with no job (409), unknown (404)', async () => {
    const unsigned = build({ estimate: estimate({ signedAt: undefined }) });
    await expect(
      unsigned.service.openCardForEstimate('est-1', { amount: 50, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow('A signature is required before payment');
    const noDeposit = build({ estimate: estimate({ depositPercentage: undefined }) });
    await expect(
      noDeposit.service.openCardForEstimate('est-1', { amount: 50, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(BadRequestException);
    const clientOnly = build({ estimate: estimate({ dealId: undefined, dealNumber: undefined }) });
    await expect(
      clientOnly.service.openCardForEstimate('est-1', { amount: 50, attemptId: ATTEMPT, paymentMethodId: PM }, caller()),
    ).rejects.toThrow(ConflictException);
    const missing = build({ estimate: null });
    await expect(
      missing.service.openCardForEstimate('est-1', { amount: 50, attemptId: ATTEMPT, paymentMethodId: PM }, tech()),
    ).rejects.toThrow(NotFoundException);
    for (const b of [unsigned, noDeposit, clientOnly, missing]) expect(b.ledger.payments.size).toBe(0);
  });
});

describe('Keyed card — cancel and sync (POST /terminal-intents/:paymentId/…)', () => {
  it('cancel: the typed card’s intent is cancelled at Stripe and the attempt fails as cancelled on the device', async () => {
    const { service, ledger, stripe } = build({ ledger: fakeLedger([keyedRow()]) });
    const res = await service.cancel('kd-old', tech());
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_kold', 'requested_by_customer');
    expect(ledger.payments.get('kd-old')).toMatchObject({ status: 'failed', failureReason: 'Cancelled on the device' });
    expect(res.payment).toMatchObject({ id: 'kd-old', status: 'failed' });
  });

  it('sync: after the 3-D Secure step, settles from what Stripe reports, with the typed card’s brand and last 4', async () => {
    const { service, stripe, invoices } = build({ ledger: fakeLedger([keyedRow()]) });
    stripe.retrievePaymentIntent.mockResolvedValue(
      pi({ id: 'pi_kold', status: 'succeeded', metadata: { paymentId: 'kd-old' }, latest_charge: charge() }),
    );
    const res = await service.sync('kd-old', tech());
    expect(stripe.retrievePaymentIntent).toHaveBeenCalledWith('pi_kold', { expandCharge: true });
    expect(res.payment).toMatchObject({ status: 'settled', cardBrand: 'visa', last4: '4242', stripeChargeId: 'ch_k' });
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 60);
  });

  it('sync: a failed 3-D Secure step fails the attempt with Stripe’s reason', async () => {
    const { service, ledger, stripe } = build({ ledger: fakeLedger([keyedRow()]) });
    stripe.retrievePaymentIntent.mockResolvedValue(
      pi({
        id: 'pi_kold',
        status: 'requires_payment_method',
        metadata: { paymentId: 'kd-old' },
        last_payment_error: { type: 'card_error', message: 'We are unable to authenticate your payment method.' },
      }),
    );
    await service.sync('kd-old', tech());
    expect(ledger.payments.get('kd-old')).toMatchObject({
      status: 'failed',
      failureReason: 'We are unable to authenticate your payment method.',
    });
  });
});
