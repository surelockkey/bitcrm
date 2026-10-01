/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PortalPaymentsService } from 'src/payments/portal-payments.service';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import type { Estimate } from '@bitcrm/types';
import { mockCrmClient, mockDealClient, mockEvents, NOW } from './mocks';
import { fakeInvoices, fakeLedger, invoice, mockStripeService, payment } from './payment-mocks';

const TOKEN = 'T'.repeat(43);

/** A job estimate the client already signed (approved on the portal), asking for a 50% deposit of $200. */
const estimate = (over: Partial<Estimate> = {}): Estimate =>
  ({
    id: 'est-1',
    number: 'K4T9ZW-1',
    dealId: 'deal-1',
    dealNumber: 'K4T9ZW',
    contactId: 'contact-1',
    status: 'approved',
    approvedAt: NOW,
    approvedVia: 'portal',
    estimateDate: '2026-09-20',
    totals: { subtotal: 200, discount: 0, taxRatePercent: 0, tax: 0, total: 200, amountPaid: 0, balanceDue: 200 },
    depositPercentage: 50,
    sentAt: '2026-09-20T12:00:00.000Z',
    version: 1,
    createdBy: 'u-1',
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-20T12:00:00.000Z',
    ...over,
  }) as Estimate;

async function build(
  over: {
    ledger?: ReturnType<typeof fakeLedger>;
    stripe?: any;
    settings?: Record<string, unknown>;
    invoice?: ReturnType<typeof invoice>;
    estimate?: Estimate;
  } = {},
) {
  const ledger = over.ledger ?? fakeLedger();
  const invoices = fakeInvoices(over.invoice ?? invoice(), ledger);
  const settings = new PaymentSettingsService(ledger as any);
  await settings.update({ onlinePaymentsEnabled: true, cardEnabled: true, bankEnabled: true, ...over.settings }, 'u-1');
  const stripe = over.stripe === null ? undefined : (over.stripe ?? mockStripeService());
  const payments = new PaymentsService(
    ledger as any,
    invoices as any,
    settings as any,
    mockDealClient() as any,
    stripe as any,
    mockEvents() as any,
  );
  const portal = {
    sentInvoiceFor: jest.fn(async (token: string, id: string) => {
      if (token !== TOKEN) throw new NotFoundException('This link is no longer valid');
      const inv = await invoices.getStored(id);
      if (!inv || !inv.sentAt) throw new NotFoundException('Document not found');
      return inv;
    }),
    resolveContact: jest.fn(async (token: string) => {
      if (token !== TOKEN) throw new NotFoundException('This link is no longer valid');
      return 'contact-1';
    }),
    sentEstimateFor: jest.fn(async (token: string, id: string) => {
      if (token !== TOKEN) throw new NotFoundException('This link is no longer valid');
      const est = over.estimate ?? estimate();
      if (est.id !== id || !est.sentAt) throw new NotFoundException('Document not found');
      return est;
    }),
  };
  const service = new PortalPaymentsService(
    portal as any,
    ledger as any,
    settings,
    mockCrmClient() as any,
    stripe as any,
  );
  return { service, ledger, invoices, settings, stripe, portal, payments };
}

describe('portal payment options', () => {
  it('describes what the client may pay', async () => {
    const { service } = await build();
    const opts = await service.options(TOKEN, 'deal-1');
    expect(opts).toMatchObject({
      invoiceId: 'deal-1',
      number: 'K4T9ZW',
      amountDue: 100,
      amountPending: 0,
      currency: 'usd',
      methods: ['card', 'bank'],
      allowPartial: true,
      surchargePercent: 0,
    });
  });

  it('deducts what has already settled and shows what is still clearing', async () => {
    const ledger = fakeLedger([
      payment({ id: 'a', amount: 30, status: 'settled' }),
      payment({ id: 'b', amount: 20, status: 'pending', method: 'bank' }),
    ]);
    const { service } = await build({ ledger });
    const opts = await service.options(TOKEN, 'deal-1');
    expect(opts.amountDue).toBe(70);
    expect(opts.amountPending).toBe(20);
  });

  it('offers nothing when online payments are switched off', async () => {
    const { service } = await build({ settings: { onlinePaymentsEnabled: false } });
    expect((await service.options(TOKEN, 'deal-1')).methods).toEqual([]);
  });

  it('keeps "nothing owed" and "cannot pay online" as different answers', async () => {
    const settled = fakeLedger([payment({ id: 'a', amount: 100, status: 'settled' })]);
    const { service } = await build({ ledger: settled });
    const opts = await service.options(TOKEN, 'deal-1');
    expect(opts.amountDue).toBe(0);
    expect(opts.methods).toEqual(['card', 'bank']);
  });

  it('offers nothing when Stripe is not configured, and still answers', async () => {
    const { service } = await build({ stripe: null });
    const opts = await service.options(TOKEN, 'deal-1');
    expect(opts.methods).toEqual([]);
    expect(opts.amountDue).toBe(100);
  });

  it("narrows to the document's own Let-client-pay-with choice", async () => {
    const { service } = await build({ invoice: invoice({ allowedMethods: ['bank'] }) });
    expect((await service.options(TOKEN, 'deal-1')).methods).toEqual(['bank']);
  });

  it('404s an unsent invoice and a bad token alike', async () => {
    const { service } = await build({ invoice: invoice({ sentAt: undefined }) });
    await expect(service.options(TOKEN, 'deal-1')).rejects.toThrow(NotFoundException);
    const other = await build();
    await expect(other.service.options('X'.repeat(43), 'deal-1')).rejects.toThrow(NotFoundException);
  });
});

describe('portal pay — the amount is clamped server-side', () => {
  it('opens a Stripe session for a valid amount and returns its client secret', async () => {
    const { service, ledger, stripe } = await build();
    const session = await service.pay(TOKEN, 'deal-1', { amount: 100, method: 'card' });

    expect(session).toMatchObject({
      clientSecret: 'cs_test_1_secret',
      publishableKey: 'pk_test_123',
      amount: 100,
      surcharge: 0,
      total: 100,
      currency: 'usd',
    });
    // The ledger row exists first, pending, so the webhook can find it.
    const created = ledger.payments.get(session.paymentId)!;
    expect(created.status).toBe('pending');
    expect(created.source).toBe('portal');
    expect(created.takenBy).toBe('client');
    expect(created.stripeSessionId).toBe('cs_test_1');
    expect(ledger.pointers.get('cs_test_1')).toBe(session.paymentId);
    // The intent id is the "customer confirmed" marker — the webhook writes it, not us.
    expect(created.stripePaymentIntentId).toBeUndefined();
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: 'deal-1', dealId: 'deal-1', method: 'card' }),
    );

    // Stripe must send the customer back to the page they came from, with both ids.
    const { returnUrl } = stripe.createCheckoutSession.mock.calls[0][0];
    expect(returnUrl).toBe(`http://localhost:3000/${TOKEN}?payment=${session.paymentId}&invoice=deal-1`);
    expect(session.publishableKey).toBe('pk_test_123');
  });

  it('accepts a partial amount when the account allows one', async () => {
    const { service } = await build();
    await expect(service.pay(TOKEN, 'deal-1', { amount: 40, method: 'card' })).resolves.toMatchObject({ amount: 40 });
  });

  it('refuses zero and negative amounts', async () => {
    const { service, ledger } = await build();
    for (const amount of [0, -10]) {
      await expect(service.pay(TOKEN, 'deal-1', { amount, method: 'card' })).rejects.toThrow(BadRequestException);
    }
    expect(ledger.payments.size).toBe(0);
  });

  it('refuses more than the balance instead of quietly charging the balance', async () => {
    const { service, stripe } = await build();
    await expect(service.pay(TOKEN, 'deal-1', { amount: 100.01, method: 'card' })).rejects.toThrow(
      /more than the balance/i,
    );
    await expect(service.pay(TOKEN, 'deal-1', { amount: 1_000_000, method: 'card' })).rejects.toThrow(
      BadRequestException,
    );
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses a partial payment when the account requires payment in full', async () => {
    const { service } = await build({ settings: { allowPartial: false } });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 40, method: 'card' })).rejects.toThrow(/full/i);
    await expect(service.pay(TOKEN, 'deal-1', { amount: 100, method: 'card' })).resolves.toBeTruthy();
  });

  it('refuses a bank payment under the account minimum', async () => {
    const { service } = await build({ settings: { bankMinimum: 50 } });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 40, method: 'bank' })).rejects.toThrow(/minimum/i);
  });

  it('refuses a method the invoice does not offer', async () => {
    const { service } = await build({ invoice: invoice({ allowedMethods: ['card'] }) });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 100, method: 'bank' })).rejects.toThrow(BadRequestException);
  });

  it('supersedes the open session when the client changes the amount and pays again', async () => {
    const { service, stripe, ledger } = await build();
    const first = await service.pay(TOKEN, 'deal-1', { amount: 50, method: 'card' });
    const second = await service.pay(TOKEN, 'deal-1', { amount: 80, method: 'card' });

    expect(second.paymentId).not.toBe(first.paymentId);
    expect(second.amount).toBe(80);
    // The abandoned attempt is cancelled at Stripe AND in the ledger, so the
    // invoice can never be collected twice.
    expect(stripe.expireSession).toHaveBeenCalledWith('cs_test_1');
    expect(ledger.payments.get(first.paymentId)!.status).toBe('failed');
    expect(ledger.payments.get(second.paymentId)!.status).toBe('pending');
  });

  it('never supersedes a bank payment the client already confirmed', async () => {
    const clearing = payment({
      id: 'ach',
      status: 'pending',
      method: 'bank',
      amount: 60,
      stripeSessionId: 'cs_ach',
      stripePaymentIntentId: 'pi_ach',
    });
    const { service, stripe, ledger } = await build({ ledger: fakeLedger([clearing]) });
    // 100 owed, 60 already on its way ⇒ at most 40 more.
    await expect(service.pay(TOKEN, 'deal-1', { amount: 50, method: 'card' })).rejects.toThrow(BadRequestException);
    const ok = await service.pay(TOKEN, 'deal-1', { amount: 40, method: 'card' });
    expect(ok.amount).toBe(40);
    expect(stripe.expireSession).not.toHaveBeenCalled();
    expect(ledger.payments.get('ach')!.status).toBe('pending');
  });

  it('refuses a new attempt while the whole balance is already clearing', async () => {
    const clearing = payment({
      id: 'ach',
      status: 'pending',
      method: 'bank',
      amount: 100,
      stripeSessionId: 'cs_ach',
      stripePaymentIntentId: 'pi_ach',
    });
    const { service } = await build({ ledger: fakeLedger([clearing]) });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 10, method: 'card' })).rejects.toThrow(ConflictException);
  });

  it('starts fresh once an abandoned session has aged out', async () => {
    const stale = payment({
      id: 'old',
      status: 'pending',
      stripeSessionId: 'cs_old',
      createdAt: '2020-01-01T00:00:00.000Z',
      takenAt: '2020-01-01T00:00:00.000Z',
      amount: 10,
    });
    const { service, ledger } = await build({ ledger: fakeLedger([stale]) });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 50, method: 'card' })).resolves.toBeTruthy();
    // Aged out: left to the reconciliation sweep, not cancelled here.
    expect(ledger.payments.get('old')!.status).toBe('pending');
  });

  it('returns the client to the exact portal page they came from', async () => {
    const { service, stripe } = await build();
    const session = await service.pay(TOKEN, 'deal-1', {
      amount: 10,
      method: 'card',
      returnPath: `/${TOKEN}/invoice/deal-1`,
    });
    expect(stripe.createCheckoutSession.mock.calls[0][0].returnUrl).toBe(
      `http://localhost:3000/${TOKEN}/invoice/deal-1?payment=${session.paymentId}&invoice=deal-1`,
    );
  });

  it('refuses to be redirected off the portal by a crafted return path', async () => {
    const { service, stripe } = await build();
    for (const bad of ['//evil.example.com', 'https://evil.example.com', '/other-token/x', `/${TOKEN}/../../x`]) {
      stripe.createCheckoutSession.mockClear();
      const session = await service.pay(TOKEN, 'deal-1', { amount: 1, method: 'card', returnPath: bad });
      expect(stripe.createCheckoutSession.mock.calls[0][0].returnUrl).toBe(
        `http://localhost:3000/${TOKEN}?payment=${session.paymentId}&invoice=deal-1`,
      );
    }
  });

  it('refuses when nothing is owed', async () => {
    const ledger = fakeLedger([payment({ id: 'a', amount: 100, status: 'settled' })]);
    const { service } = await build({ ledger });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 10, method: 'card' })).rejects.toThrow(/nothing/i);
  });

  it('reports online payments unavailable rather than crashing with no Stripe key', async () => {
    const { service } = await build({ stripe: null });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 100, method: 'card' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('offers nothing, and refuses to start, when only half of Stripe is configured', async () => {
    const half = mockStripeService({ onlineReady: false, publishableKey: '' });
    const { service } = await build({ stripe: half });
    expect((await service.options(TOKEN, 'deal-1')).methods).toEqual([]);
    await expect(service.pay(TOKEN, 'deal-1', { amount: 10, method: 'card' })).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('adds the surcharge on top, never into the invoice total', async () => {
    const { service, stripe } = await build({ settings: { surchargePercent: 3 } });
    const session = await service.pay(TOKEN, 'deal-1', { amount: 100, method: 'card' });
    expect(session).toMatchObject({ amount: 100, surcharge: 3, total: 103 });
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(expect.objectContaining({ amount: 100, surcharge: 3 }));
  });
});

describe('portal pay — signature first (Workiz "Request signature")', () => {
  it('refuses to take money for an invoice that asks for a signature nobody has given yet', async () => {
    const { service, ledger, stripe } = await build({ invoice: invoice({ requestSignature: true }) });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 100, method: 'card' })).rejects.toThrow(ConflictException);
    await expect(service.pay(TOKEN, 'deal-1', { amount: 100, method: 'card' })).rejects.toThrow(/sign the invoice first/i);
    expect(ledger.payments.size).toBe(0);
    expect(stripe.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('takes the payment once the invoice is signed', async () => {
    const { service } = await build({
      invoice: invoice({ requestSignature: true, signedAt: '2026-09-21T12:00:00.000Z' }),
    });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 100, method: 'card' })).resolves.toMatchObject({ amount: 100 });
  });

  it('asks for nothing when the invoice was sent without "Request signature"', async () => {
    const { service } = await build({ invoice: invoice({ requestSignature: false }) });
    await expect(service.pay(TOKEN, 'deal-1', { amount: 100, method: 'card' })).resolves.toMatchObject({ amount: 100 });
  });
});

describe('portal payment poll', () => {
  it('reports the payment the client just made', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', amount: 40, status: 'pending', method: 'bank' })]);
    const { service } = await build({ ledger });
    await expect(service.status(TOKEN, 'p1')).resolves.toEqual({
      status: 'pending',
      amount: 40,
      method: 'bank',
      receiptSent: false,
    });
  });

  it('404s a payment belonging to someone else', async () => {
    const ledger = fakeLedger([payment({ id: 'p1', contactId: 'someone-else' })]);
    const { service } = await build({ ledger });
    await expect(service.status(TOKEN, 'p1')).rejects.toThrow(NotFoundException);
  });

  it('404s an unknown payment', async () => {
    const { service } = await build();
    await expect(service.status(TOKEN, 'nope')).rejects.toThrow(NotFoundException);
  });
});


describe('estimate deposit (portal)', () => {
  it('describes the deposit: what Workiz calls "Required deposit", less what already settled on it', async () => {
    const ledger = fakeLedger([payment({ id: 'dep-1', amount: 40, status: 'settled', estimateId: 'est-1' })]);
    const { service } = await build({ ledger });
    const opts = await service.depositOptions(TOKEN, 'est-1');
    expect(opts).toMatchObject({
      estimateId: 'est-1',
      number: 'K4T9ZW-1',
      depositDue: 100,
      amountPaid: 40,
      amountDue: 60,
      amountPending: 0,
      signed: true,
      methods: ['card', 'bank'],
    });
  });

  it('opens a Checkout Session for the deposit on the JOB’s ledger, tagged with the estimate', async () => {
    const { service, ledger, stripe } = await build();
    const session = await service.payDeposit(TOKEN, 'est-1', { amount: 100, method: 'card' });
    expect(session.amount).toBe(100);
    const row = [...ledger.payments.values()][0];
    expect(row).toMatchObject({
      invoiceId: 'deal-1',
      dealId: 'deal-1',
      estimateId: 'est-1',
      amount: 100,
      status: 'pending',
      source: 'portal',
      takenBy: 'client',
    });
    expect(stripe.createCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'Deposit for estimate K4T9ZW-1', dealId: 'deal-1' }),
    );
  });

  it('signature first: an estimate the client has not approved cannot take a deposit', async () => {
    const { service, ledger } = await build({ estimate: estimate({ status: 'pending', approvedAt: undefined, approvedVia: undefined }) });
    await expect(service.payDeposit(TOKEN, 'est-1', { amount: 100, method: 'card' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(ledger.payments.size).toBe(0);
  });

  it('refuses an estimate with no deposit, one with no job, and more than the deposit', async () => {
    const none = await build({ estimate: estimate({ depositPercentage: undefined }) });
    await expect(none.service.payDeposit(TOKEN, 'est-1', { amount: 10, method: 'card' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const noJob = await build({ estimate: estimate({ dealId: undefined, dealNumber: undefined }) });
    await expect(noJob.service.payDeposit(TOKEN, 'est-1', { amount: 100, method: 'card' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    const { service } = await build();
    await expect(service.payDeposit(TOKEN, 'est-1', { amount: 150, method: 'card' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('404s an unsent estimate or a bad token', async () => {
    const { service } = await build({ estimate: estimate({ sentAt: undefined }) });
    await expect(service.depositOptions(TOKEN, 'est-1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.payDeposit('x'.repeat(43), 'est-1', { amount: 1, method: 'card' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
