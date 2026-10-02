/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Estimate, Payment } from '@bitcrm/types';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { StripeEventsHandler } from 'src/payments/stripe/stripe-events.handler';
import { TerminalService } from 'src/payments/terminal/terminal.service';
import { DataScope, billingView, caller, dealProduct, mockDealClient, mockEvents, profile } from './mocks';
import { PAY_NOW, fakeInvoices, fakeLedger, invoice, mockStripeService, payment } from './payment-mocks';

const SIGNED = '2026-09-22T11:00:00.000Z';
const ATTEMPT = '0b9c6d2e-4f1a-4c3b-9d8e-7a6b5c4d3e2f';
const OTHER_ATTEMPT = '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f';

/** The assigned technician holding the phone (`assigned_only`, on deal-1's roster). */
const tech = () => caller(DataScope.ASSIGNED_ONLY, { id: 'tech-1', email: 'tech@example.com' });

/** A job estimate the client signed, asking for a 50% deposit of $200 ⇒ $100. */
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

/** A Tap to Pay attempt already in the ledger. */
const attempt = (over: Partial<Payment> = {}): Payment =>
  payment({
    id: 'att-old',
    status: 'pending',
    source: 'field',
    takenBy: 'tech-1',
    channel: 'terminal',
    transactionMethod: 'Tap to Pay',
    amount: 100,
    stripePaymentIntentId: 'pi_old',
    createdAt: PAY_NOW,
    ...over,
  });

function build(
  over: {
    ledger?: ReturnType<typeof fakeLedger>;
    stripe?: ReturnType<typeof mockStripeService>;
    invoice?: ReturnType<typeof invoice>;
    estimate?: Estimate | null;
    profile?: ReturnType<typeof profile>;
  } = {},
) {
  const ledger = over.ledger ?? fakeLedger();
  for (const p of ledger.payments.values()) if (p.stripePaymentIntentId) ledger.pointers.set(p.stripePaymentIntentId, p.id);
  const invoices = fakeInvoices(over.invoice ?? invoice({ signedAt: SIGNED }), ledger);
  const settings = new PaymentSettingsService(ledger as any);
  const deal = mockDealClient();
  // The job is worth exactly the invoice's $100.
  deal.getBillingView.mockResolvedValue(billingView({}, [dealProduct({ quantity: 1, priceClient: 100, taxable: false })]));
  const stripe = over.stripe ?? mockStripeService();
  const events = mockEvents();
  const payments = new PaymentsService(ledger as any, invoices as any, settings, deal as any, stripe as any, events as any);
  const handler = new StripeEventsHandler(ledger as any, payments, stripe as any);
  const est = over.estimate === undefined ? estimate() : over.estimate;
  const estimates = { getStored: jest.fn(async (id: string) => (est && est.id === id ? { ...est } : null)) };
  const company = over.profile ?? profile({ address: { street: '1 Main St', unit: 'Suite 2', city: 'Hartford', state: 'CT', zip: '06103' } });
  const profiles = { getDefault: jest.fn(async () => company) };
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
  return { service, ledger, invoices, settings, deal, stripe, events, payments, handler, estimates, profiles, signatures };
}

describe('Terminal — the connection token and the Location', () => {
  it('mints a connection token for the phone, scoped to the account’s Location', async () => {
    const { service, settings, stripe } = build();
    await settings.setTerminalLocation('tml_1', 'u-1');
    await expect(service.connectionToken()).resolves.toEqual({ secret: 'pst_test_1' });
    expect(stripe.createConnectionToken).toHaveBeenCalledWith('tml_1');
  });

  it('answers 503 without Stripe', async () => {
    const { service } = build({ stripe: mockStripeService({ available: false }) });
    await expect(service.connectionToken()).rejects.toThrow(ServiceUnavailableException);
  });

  it('has no Location until one is created', async () => {
    const { service } = build();
    await expect(service.location()).resolves.toEqual({ locationId: null });
  });

  it('creates ONE Location from the default company’s address and keeps its id in payment settings', async () => {
    const { service, stripe, settings } = build();
    const created = await service.ensureLocation(caller());
    expect(created).toEqual({
      locationId: 'tml_1',
      displayName: 'Sure Lock Key',
      address: { line1: '1 Main St', line2: 'Suite 2', city: 'Hartford', state: 'CT', postalCode: '06103', country: 'US' },
    });
    expect(stripe.createTerminalLocation).toHaveBeenCalledWith({
      displayName: 'Sure Lock Key',
      address: { line1: '1 Main St', line2: 'Suite 2', city: 'Hartford', state: 'CT', postal_code: '06103', country: 'US' },
      idempotencyKey: expect.stringMatching(/^terminal_location_/),
    });
    expect((await settings.get()).terminalLocationId).toBe('tml_1');
    await expect(service.location()).resolves.toEqual({ locationId: 'tml_1' });

    // Asking again changes nothing — still one Location.
    await expect(service.ensureLocation(caller())).resolves.toEqual({ locationId: 'tml_1' });
    expect(stripe.createTerminalLocation).toHaveBeenCalledTimes(1);
  });

  it('400s, naming what is missing, when the company address is incomplete — Stripe is never called', async () => {
    const partial = build({ profile: profile({ address: { street: '', city: 'Hartford', state: '', zip: '06103' } }) });
    const err = await partial.service.ensureLocation(caller()).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toMatch(/street/);
    expect(err.message).toMatch(/state/);
    expect(err.message).not.toMatch(/city/);
    expect(partial.stripe.createTerminalLocation).not.toHaveBeenCalled();

    const none = build({ profile: profile({ address: undefined }) });
    await expect(none.service.ensureLocation(caller())).rejects.toThrow(BadRequestException);
    expect((await none.settings.get()).terminalLocationId).toBeUndefined();
  });
});

describe('Terminal — a card on the invoice (POST /invoices/:id/terminal-intent)', () => {
  it('writes the pending ledger row FIRST, then a card_present intent for amount + tip, and answers its client secret', async () => {
    const { service, ledger, stripe, invoices, deal } = build();
    let rowFirst = false;
    stripe.createTerminalIntent.mockImplementationOnce(async (input: any) => {
      rowFirst = ledger.payments.get(input.metadata.paymentId)?.status === 'pending';
      return { id: 'pi_new', client_secret: 'pi_new_secret_1', status: 'requires_payment_method' };
    });

    const res = await service.openForInvoice('deal-1', { amount: 60, tipAmount: 9, attemptId: ATTEMPT }, tech());

    expect(rowFirst).toBe(true);
    expect(res).toEqual({
      paymentId: ATTEMPT,
      intentId: 'pi_new',
      clientSecret: 'pi_new_secret_1',
      amount: 60,
      tipAmount: 9,
      feeAmount: 0,
      total: 69,
      currency: 'usd',
      status: 'pending',
    });
    expect(stripe.createTerminalIntent).toHaveBeenCalledWith({
      amount: 60,
      tipAmount: 9,
      feeAmount: 0,
      currency: 'usd',
      description: 'Invoice K4T9ZW',
      metadata: {
        paymentId: ATTEMPT,
        invoiceId: 'deal-1',
        dealId: 'deal-1',
        contactId: 'contact-1',
        channel: 'terminal',
        env: expect.any(String),
      },
      idempotencyKey: `terminal_${ATTEMPT}`,
    });
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({
      invoiceId: 'deal-1',
      dealId: 'deal-1',
      contactId: 'contact-1',
      amount: 60,
      tipAmount: 9,
      method: 'card',
      channel: 'terminal',
      transactionMethod: 'Tap to Pay',
      status: 'pending',
      source: 'field',
      takenBy: 'tech-1',
      technicianId: 'tech-1',
      serviceAreaId: 'sa-1',
      stripePaymentIntentId: 'pi_new',
    });
    // The webhook can resolve the intent even without metadata.
    expect(ledger.pointers.get('pi_new')).toBe(ATTEMPT);
    // Nothing counts until the card is actually charged.
    expect(invoices.applyAmountPaid).not.toHaveBeenCalled();
    expect(deal.addTimeline).not.toHaveBeenCalled();
  });

  it('is idempotent on attemptId: a retry gets the same row and the same intent back', async () => {
    const { service, ledger, stripe } = build();
    // Stripe answers the same intent the first POST created.
    stripe.retrievePaymentIntent.mockImplementation(async (id: string) => ({
      id,
      client_secret: `${id}_secret_1`,
      status: 'requires_payment_method',
    }));
    const first = await service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech());
    const again = await service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT.toUpperCase() }, tech());
    expect(again).toEqual(first);
    expect(stripe.createTerminalIntent).toHaveBeenCalledTimes(1);
    expect(ledger.payments.size).toBe(1);
  });

  it('tells a retry of an attempt that already went through that it is settled', async () => {
    const { service, ledger, stripe } = build();
    stripe.retrievePaymentIntent.mockImplementation(async (id: string) => ({ id, client_secret: `${id}_s`, status: 'succeeded' }));
    await service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech());
    ledger.payments.set(ATTEMPT, { ...ledger.payments.get(ATTEMPT)!, status: 'settled', settledAt: PAY_NOW });
    await expect(service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      paymentId: ATTEMPT,
      status: 'settled',
    });
  });

  it('refuses a retry of an attempt that did not go through — the phone starts a new one (balance and signature re-checked)', async () => {
    const { service, ledger, stripe } = build();
    await service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech());
    ledger.payments.set(ATTEMPT, { ...ledger.payments.get(ATTEMPT)!, status: 'failed', failureReason: 'Cancelled on the device' });
    await expect(service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      /did not go through/i,
    );
    expect(stripe.retrievePaymentIntent).not.toHaveBeenCalled();
  });

  it('a retry that finds the card already charged at Stripe (webhook not here yet) answers settled', async () => {
    const { service, ledger, stripe, invoices } = build();
    await service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech());
    stripe.retrievePaymentIntent.mockImplementation(async (id: string) => ({
      id,
      object: 'payment_intent',
      client_secret: `${id}_secret_1`,
      status: 'succeeded',
      metadata: { paymentId: ATTEMPT },
    }));
    await expect(service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      paymentId: ATTEMPT,
      status: 'settled',
    });
    expect(ledger.payments.get(ATTEMPT)!.status).toBe('settled');
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 60);
  });

  it('refuses an attemptId re-used for another amount, another document or by another user (409)', async () => {
    const { service, estimates } = build();
    await service.openForInvoice('deal-1', { amount: 60, tipAmount: 5, attemptId: ATTEMPT }, tech());
    await expect(service.openForInvoice('deal-1', { amount: 61, tipAmount: 5, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      ConflictException,
    );
    await expect(service.openForInvoice('deal-1', { amount: 60, tipAmount: 6, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      ConflictException,
    );
    await expect(service.openForEstimate('est-1', { amount: 60, tipAmount: 5, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      ConflictException,
    );
    expect(estimates.getStored).toHaveBeenCalled();
    await expect(
      service.openForInvoice('deal-1', { amount: 60, tipAmount: 5, attemptId: ATTEMPT }, caller(DataScope.ALL, { id: 'u-9' })),
    ).rejects.toThrow(ConflictException);
  });

  it('clamps like recording a payment: 400 above the balance or when nothing is owed; the tip is never clamped', async () => {
    const { service, ledger } = build();
    await expect(service.openForInvoice('deal-1', { amount: 100.01, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      /more than the balance/i,
    );
    await expect(service.openForInvoice('deal-1', { amount: 0, attemptId: ATTEMPT }, tech())).rejects.toThrow(BadRequestException);
    await expect(service.openForInvoice('deal-1', { amount: 40, tipAmount: -1, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.openForInvoice('deal-1', { amount: 10, attemptId: 'not-a-uuid' }, tech())).rejects.toThrow(
      BadRequestException,
    );
    expect(ledger.payments.size).toBe(0);

    // A partial payment with a large tip is fine — the tip is not toward the balance.
    await expect(service.openForInvoice('deal-1', { amount: 40, tipAmount: 500, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      amount: 40,
      tipAmount: 500,
      total: 540,
    });

    const paid = build({ ledger: fakeLedger([payment({ id: 'cash', amount: 100, method: 'cash', source: 'office' })]) });
    await expect(paid.service.openForInvoice('deal-1', { amount: 10, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      /nothing left to pay/i,
    );
  });

  it('signature first: 409 "A signature is required before payment" until the invoice has one on file', async () => {
    const { service, ledger, stripe, signatures } = build({ invoice: invoice({ signedAt: undefined }) });
    const err = await service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech()).catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe('A signature is required before payment');
    expect(ledger.payments.size).toBe(0);
    expect(stripe.createTerminalIntent).not.toHaveBeenCalled();
    expect(signatures.hasAny).toHaveBeenCalledWith('invoice', 'deal-1');

    // A signature row counts even if the stamp on the invoice is missing.
    signatures.hasAny.mockResolvedValueOnce(true);
    await expect(service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      status: 'pending',
    });
  });

  it('refuses a client invoice (409), a technician off the job (403), an unknown invoice (404), no Stripe (503) — writing nothing', async () => {
    const client = build({ invoice: invoice({ id: 'inv-c1', dealId: undefined, signedAt: SIGNED }) });
    await expect(client.service.openForInvoice('inv-c1', { amount: 10, attemptId: ATTEMPT }, caller())).rejects.toThrow(
      ConflictException,
    );

    const off = build();
    off.deal.getBillingView.mockResolvedValue(billingView({ assignedTechIds: ['someone-else'] }));
    await expect(off.service.openForInvoice('deal-1', { amount: 10, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      ForbiddenException,
    );

    const missing = build();
    await expect(missing.service.openForInvoice('nope', { amount: 10, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      NotFoundException,
    );

    const offline = build({ stripe: mockStripeService({ available: false }) });
    await expect(offline.service.openForInvoice('deal-1', { amount: 10, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      ServiceUnavailableException,
    );
    for (const b of [client, off, missing, offline]) expect(b.ledger.payments.size).toBe(0);
  });

  it('replaces the caller’s own unconfirmed attempt (cancelled at Stripe) but never another user’s, which caps the amount', async () => {
    const ledger = fakeLedger([
      attempt({ id: 'att-mine', amount: 100, stripePaymentIntentId: 'pi_mine' }),
      attempt({ id: 'att-theirs', amount: 30, takenBy: 'tech-2', stripePaymentIntentId: 'pi_theirs' }),
    ]);
    const { service, stripe } = build({ ledger });

    // $100 owed, $30 of it on another phone right now ⇒ at most $70 here.
    await expect(service.openForInvoice('deal-1', { amount: 71, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      BadRequestException,
    );
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_mine', 'abandoned');
    expect(stripe.cancelPaymentIntent).not.toHaveBeenCalledWith('pi_theirs', expect.anything());
    expect(ledger.payments.get('att-mine')).toMatchObject({
      status: 'failed',
      failureReason: 'Replaced by a newer payment attempt',
    });
    expect(ledger.payments.get('att-theirs')!.status).toBe('pending');

    await expect(service.openForInvoice('deal-1', { amount: 70, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      amount: 70,
    });
  });

  it('settles — never replaces — an earlier attempt that already went through, so the card is not charged twice', async () => {
    const ledger = fakeLedger([attempt({ id: 'att-done', amount: 100, stripePaymentIntentId: 'pi_done' })]);
    const { service, stripe, invoices } = build({ ledger });
    stripe.cancelPaymentIntent.mockRejectedValueOnce(new Error('This PaymentIntent has already succeeded'));
    stripe.retrievePaymentIntent.mockResolvedValueOnce({ id: 'pi_done', status: 'succeeded', latest_charge: 'ch_done' } as any);

    await expect(service.openForInvoice('deal-1', { amount: 100, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      /nothing left to pay/i,
    );
    expect(ledger.payments.get('att-done')!.status).toBe('settled');
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 100);
    expect(ledger.payments.has(ATTEMPT)).toBe(false);
  });

  it('adds the account’s service fee — surchargePercent of amount + tip — to the row and the charge, never to the balance', async () => {
    const { service, ledger, stripe, settings, invoices } = build();
    await settings.update({ surchargePercent: 3 }, 'u-1');

    const res = await service.openForInvoice('deal-1', { amount: 60, tipAmount: 9, attemptId: ATTEMPT }, tech());

    // 3 % of $69 = $2.07, charged with the rest.
    expect(res).toMatchObject({ amount: 60, tipAmount: 9, feeAmount: 2.07, total: 71.07 });
    expect(stripe.createTerminalIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 60, tipAmount: 9, feeAmount: 2.07 }),
    );
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({ amount: 60, tipAmount: 9, feeAmount: 2.07 });

    // A retry answers the same numbers, whatever the settings say by then.
    await settings.update({ surchargePercent: 1 }, 'u-1');
    stripe.retrievePaymentIntent.mockImplementation(async (id: string) => ({
      id,
      client_secret: `${id}_secret_1`,
      status: 'requires_payment_method',
    }));
    await expect(service.openForInvoice('deal-1', { amount: 60, tipAmount: 9, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      feeAmount: 2.07,
      total: 71.07,
    });

    // Once the card is charged, only the $60 counts toward the invoice.
    stripe.retrievePaymentIntent.mockResolvedValue({
      id: res.intentId,
      object: 'payment_intent',
      status: 'succeeded',
      metadata: { paymentId: ATTEMPT },
    } as any);
    await service.sync(ATTEMPT, tech());
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 60);
  });

  it('charges no fee and leaves the row without one when the account has none (the default)', async () => {
    const { service, ledger } = build();
    await expect(service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      feeAmount: 0,
      total: 60,
    });
    expect(ledger.payments.get(ATTEMPT)!.feeAmount).toBeUndefined();
  });

  it('leaves no phantom row when Stripe refuses the intent', async () => {
    const { service, ledger, stripe } = build();
    stripe.createTerminalIntent.mockRejectedValueOnce(new Error('Stripe is down'));
    await expect(service.openForInvoice('deal-1', { amount: 60, attemptId: ATTEMPT }, tech())).rejects.toThrow('Stripe is down');
    expect(ledger.payments.size).toBe(0);
  });
});

describe('Terminal — a deposit on the estimate (POST /estimates/:id/terminal-intent)', () => {
  it('takes it on the JOB’s ledger, tagged with the estimate, against what is still owed of the deposit', async () => {
    const ledger = fakeLedger([payment({ id: 'dep-1', estimateId: 'est-1', amount: 40, method: 'cash', source: 'office' })]);
    const { service, stripe } = build({ ledger });

    // $100 deposit, $40 already paid ⇒ $60 left.
    await expect(service.openForEstimate('est-1', { amount: 61, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      BadRequestException,
    );
    const res = await service.openForEstimate('est-1', { amount: 60, tipAmount: 5, attemptId: ATTEMPT }, tech());
    expect(res).toMatchObject({ paymentId: ATTEMPT, amount: 60, tipAmount: 5, feeAmount: 0, total: 65, status: 'pending' });
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({
      invoiceId: 'deal-1',
      dealId: 'deal-1',
      estimateId: 'est-1',
      channel: 'terminal',
      method: 'card',
      status: 'pending',
    });
    expect(stripe.createTerminalIntent).toHaveBeenCalledWith(
      expect.objectContaining({
        description: 'Deposit for estimate K4T9ZW-1',
        metadata: expect.objectContaining({ paymentId: ATTEMPT, estimateId: 'est-1', dealId: 'deal-1' }),
      }),
    );
    expect(stripe.createTerminalIntent.mock.calls[0][0].metadata.invoiceId).toBeUndefined();
  });

  it('adds the service fee to a deposit too — and the deposit still counts only its own amount', async () => {
    const { service, settings, stripe, ledger } = build();
    await settings.update({ surchargePercent: 2.5 }, 'u-1');
    // 2.5 % of $100 + $10 = $2.75.
    await expect(service.openForEstimate('est-1', { amount: 100, tipAmount: 10, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      amount: 100,
      feeAmount: 2.75,
      total: 112.75,
    });
    expect(stripe.createTerminalIntent).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, tipAmount: 10, feeAmount: 2.75 }));
    expect(ledger.payments.get(ATTEMPT)).toMatchObject({ estimateId: 'est-1', feeAmount: 2.75 });
  });

  it('needs no "approved" status — the signature on file is the gate', async () => {
    const { service } = build({ estimate: estimate({ status: 'unsent' }) });
    await expect(service.openForEstimate('est-1', { amount: 100, attemptId: ATTEMPT }, tech())).resolves.toMatchObject({
      amount: 100,
    });
  });

  it('refuses: unsigned (409), no deposit asked (400), a client estimate with no job (409), unknown (404)', async () => {
    const unsigned = build({ estimate: estimate({ signedAt: undefined }) });
    await expect(unsigned.service.openForEstimate('est-1', { amount: 50, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      'A signature is required before payment',
    );
    expect(unsigned.signatures.hasAny).toHaveBeenCalledWith('estimate', 'est-1');

    const noDeposit = build({ estimate: estimate({ depositPercentage: undefined }) });
    await expect(noDeposit.service.openForEstimate('est-1', { amount: 50, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      BadRequestException,
    );

    const clientOnly = build({ estimate: estimate({ dealId: undefined, dealNumber: undefined }) });
    await expect(clientOnly.service.openForEstimate('est-1', { amount: 50, attemptId: ATTEMPT }, caller())).rejects.toThrow(
      ConflictException,
    );

    const missing = build({ estimate: null });
    await expect(missing.service.openForEstimate('est-1', { amount: 50, attemptId: ATTEMPT }, tech())).rejects.toThrow(
      NotFoundException,
    );
    for (const b of [unsigned, noDeposit, clientOnly, missing]) expect(b.ledger.payments.size).toBe(0);
  });
});

describe('Terminal — cancel and sync (POST /terminal-intents/:paymentId/…)', () => {
  const stripeIntent = (over: any = {}) => ({ id: 'pi_old', object: 'payment_intent', status: 'succeeded', metadata: { paymentId: 'att-old' }, ...over });

  it('cancel: the intent is cancelled at Stripe and the attempt fails as cancelled on the device', async () => {
    const { service, ledger, stripe } = build({ ledger: fakeLedger([attempt({ amount: 60 })]) });
    const res = await service.cancel('att-old', tech());
    expect(stripe.cancelPaymentIntent).toHaveBeenCalledWith('pi_old', 'requested_by_customer');
    expect(ledger.payments.get('att-old')).toMatchObject({ status: 'failed', failureReason: 'Cancelled on the device' });
    expect(res.payment).toMatchObject({ id: 'att-old', status: 'failed' });
    expect(res.ledger).toMatchObject({ dealId: 'deal-1', amountPaid: 0, balanceDue: 100 });
  });

  it('cancel: an attempt that already went through is settled and answered 409 — it is a refund now', async () => {
    const { service, ledger, stripe } = build({ ledger: fakeLedger([attempt({ amount: 60 })]) });
    stripe.cancelPaymentIntent.mockRejectedValueOnce(new Error('already succeeded'));
    stripe.retrievePaymentIntent.mockResolvedValueOnce(stripeIntent() as any);
    await expect(service.cancel('att-old', tech())).rejects.toThrow(/refund/i);
    expect(ledger.payments.get('att-old')!.status).toBe('settled');
  });

  it('sync: settles from the intent Stripe reports, with the card, and answers the job ledger; a second sync writes nothing', async () => {
    const { service, ledger, stripe, invoices } = build({ ledger: fakeLedger([attempt({ amount: 60, tipAmount: 9 })]) });
    stripe.retrievePaymentIntent.mockResolvedValue(
      stripeIntent({
        latest_charge: {
          id: 'ch_1',
          object: 'charge',
          payment_method_details: { type: 'card_present', card_present: { brand: 'visa', last4: '4242' } },
        },
      }) as any,
    );
    const res = await service.sync('att-old', tech());
    expect(stripe.retrievePaymentIntent).toHaveBeenCalledWith('pi_old', { expandCharge: true });
    expect(res.payment).toMatchObject({ status: 'settled', cardBrand: 'visa', last4: '4242', stripeChargeId: 'ch_1', tipAmount: 9 });
    expect(res.ledger).toMatchObject({ amountPaid: 60, balanceDue: 40 });
    expect(invoices.applyAmountPaid).toHaveBeenLastCalledWith('deal-1', 60);

    const version = ledger.payments.get('att-old')!.version;
    await service.sync('att-old', tech());
    expect(ledger.payments.get('att-old')!.version).toBe(version);
  });

  it('sync: a decline fails the attempt with the bank’s reason; the same intent may still settle afterwards', async () => {
    const { service, ledger, stripe } = build({ ledger: fakeLedger([attempt({ amount: 60 })]) });
    stripe.retrievePaymentIntent.mockResolvedValueOnce(
      stripeIntent({ status: 'requires_payment_method', last_payment_error: { message: 'Your card was declined.' } }) as any,
    );
    await service.sync('att-old', tech());
    expect(ledger.payments.get('att-old')).toMatchObject({ status: 'failed', failureReason: 'Your card was declined.' });

    stripe.retrievePaymentIntent.mockResolvedValueOnce(stripeIntent() as any);
    await service.sync('att-old', tech());
    expect(ledger.payments.get('att-old')!.status).toBe('settled');
  });

  it('sync: an intent still waiting for the card changes nothing', async () => {
    const { service, ledger, stripe } = build({ ledger: fakeLedger([attempt({ amount: 60 })]) });
    stripe.retrievePaymentIntent.mockResolvedValueOnce(stripeIntent({ status: 'requires_payment_method' }) as any);
    const version = ledger.payments.get('att-old')!.version;
    const res = await service.sync('att-old', tech());
    expect(res.payment.status).toBe('pending');
    expect(ledger.payments.get('att-old')!.version).toBe(version);
  });

  it('refuses a payment not taken on a phone (409), a technician off the job (403), an unknown id (404)', async () => {
    const { service, deal } = build({
      ledger: fakeLedger([attempt(), payment({ id: 'cash', method: 'cash', source: 'office', takenBy: 'u-1' })]),
    });
    await expect(service.sync('cash', tech())).rejects.toThrow(ConflictException);
    await expect(service.cancel('cash', tech())).rejects.toThrow(ConflictException);
    await expect(service.sync('nope', tech())).rejects.toThrow(NotFoundException);
    deal.getBillingView.mockResolvedValue(billingView({ assignedTechIds: ['someone-else'] }));
    await expect(service.sync('att-old', tech())).rejects.toThrow(ForbiddenException);
    await expect(service.cancel('att-old', tech())).rejects.toThrow(ForbiddenException);
  });
});
