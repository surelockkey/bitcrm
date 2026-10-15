/* eslint-disable @typescript-eslint/no-explicit-any */
import { BadRequestException } from '@nestjs/common';
import {
  ADD_PAYMENT_TYPES,
  OFFLINE_PAYMENT_TYPES,
  PAYMENT_TYPE_METHOD,
  cardServiceFee,
  isOfflinePaymentType,
  paymentTypeLabel,
  type Payment,
} from '@bitcrm/types';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentSettingsService } from 'src/payments/payment-settings.service';
import { serviceFeeFor, surchargeFor } from 'src/payments/payment-rules';
import { paymentReportType } from 'src/payments/report/payment-report.rules';
import { billingView, caller, dealProduct, mockCrmClient, mockDealClient, mockEvents } from './mocks';
import { fakeInvoices, fakeLedger, invoice, mockStripeService } from './payment-mocks';

/**
 * Workiz's "Add payment": an Amount and a Payment type — Credit charge, Cash,
 * Credit offline, Check, Bank transfer (offline), Cash app, Consumer
 * financing, Venmo, Zelle, Debit offline. The type is the Workiz key
 * (`methodDetail`), the coarse `method` follows from it, and the offline
 * ones carry a Confirmation code (`reference`), a Paid on date (`takenAt`)
 * and "Charged by referral".
 */

describe('@bitcrm/types — the Add payment types', () => {
  it('lists Workiz’s types in Workiz’s order, Credit charge first', () => {
    expect(ADD_PAYMENT_TYPES).toEqual([
      'charge',
      'cash',
      'credit',
      'check',
      'bank_transfer_offline',
      'cash_app',
      'consumer_financing',
      'venmo',
      'zelle',
      'debit_offline',
    ]);
    expect(OFFLINE_PAYMENT_TYPES).toEqual(ADD_PAYMENT_TYPES.filter((t) => t !== 'charge'));
  });

  it('labels them as Workiz does', () => {
    expect(ADD_PAYMENT_TYPES.map(paymentTypeLabel)).toEqual([
      'Credit charge',
      'Cash',
      'Credit offline',
      'Check',
      'Bank transfer (offline)',
      'Cash app',
      'Consumer financing',
      'Venmo',
      'Zelle',
      'Debit offline',
    ]);
  });

  it('maps each to the coarse method the ledger and the reports group by', () => {
    expect(PAYMENT_TYPE_METHOD).toEqual({
      charge: 'card',
      cash: 'cash',
      credit: 'card',
      check: 'check',
      bank_transfer_offline: 'bank',
      cash_app: 'other',
      consumer_financing: 'other',
      venmo: 'other',
      zelle: 'other',
      debit_offline: 'card',
    });
  });

  it('knows an offline type from anything else', () => {
    expect(isOfflinePaymentType('zelle')).toBe(true);
    expect(isOfflinePaymentType('charge')).toBe(false);
    expect(isOfflinePaymentType('bank_transfer')).toBe(false);
    expect(isOfflinePaymentType(undefined)).toBe(false);
    expect(isOfflinePaymentType(42)).toBe(false);
  });

  it('computes the card service fee exactly as billing does — the web shows what the card is charged', () => {
    for (const [amount, tip, pct] of [
      [60, 9, 3],
      [2752, 275.2, 3],
      [33.5, 0, 3],
      [12, 0.5, 1],
      [100, 15, 0],
      [100, 15, -1],
      [Number.NaN, 0, 3],
      [19.99, 0, 3],
    ]) {
      expect(cardServiceFee(amount, tip, pct)).toBe(serviceFeeFor(amount, tip, pct));
    }
    expect(cardServiceFee(33.5, 0, 3)).toBe(1.01);
    expect(cardServiceFee(19.99, 0, 3)).toBe(surchargeFor(19.99, 3));
  });
});

function build() {
  const ledger = fakeLedger();
  const invoices = fakeInvoices(invoice(), ledger);
  const deal = mockDealClient();
  deal.getBillingView.mockImplementation(async (id: string) =>
    id === 'deal-1' ? billingView({}, [dealProduct({ quantity: 1, priceClient: 100, taxable: false })]) : null,
  );
  const service = new PaymentsService(
    ledger as any,
    invoices as any,
    new PaymentSettingsService(ledger as any),
    deal as any,
    mockStripeService() as any,
    mockEvents() as any,
    mockCrmClient() as any,
    { sendToContact: jest.fn(async () => undefined) } as any,
  );
  return { service, ledger };
}

describe('PaymentsService — an offline Add payment with its Workiz type', () => {
  it('stores the Workiz type and label, the confirmation code, the paid-on date and "charged by referral"', async () => {
    const { service, ledger } = build();
    const p = await service.recordOffline(
      'deal-1',
      {
        amount: 40,
        method: 'other',
        methodDetail: 'zelle',
        reference: 'ZL-77812',
        takenAt: '2026-10-01T16:00:00.000Z',
        chargedByReferral: true,
      },
      caller(),
    );
    expect(p).toMatchObject({
      method: 'other',
      methodDetail: 'zelle',
      methodLabel: 'Zelle',
      reference: 'ZL-77812',
      takenAt: '2026-10-01T16:00:00.000Z',
      chargedByReferral: true,
      status: 'settled',
    });
    expect(ledger.payments.get(p.id)).toMatchObject({ methodDetail: 'zelle', chargedByReferral: true });
    // The Payments report files it under Workiz's type, not "Other".
    expect(paymentReportType(ledger.payments.get(p.id) as Payment)).toBe('zelle');
  });

  it('derives the method from the type when the client sends only the type', async () => {
    const { service } = build();
    const p = await service.recordOfflineForDeal('deal-1', { amount: 10, methodDetail: 'debit_offline' }, caller());
    expect(p).toMatchObject({ method: 'card', methodDetail: 'debit_offline', methodLabel: 'Debit offline' });
    expect(p.chargedByReferral).toBeUndefined();
  });

  it('takes a bank transfer made outside Stripe as `bank` — only under its offline type', async () => {
    const { service } = build();
    const p = await service.recordOffline('deal-1', { amount: 10, method: 'bank', methodDetail: 'bank_transfer_offline' }, caller());
    expect(p).toMatchObject({ method: 'bank', methodDetail: 'bank_transfer_offline', methodLabel: 'Bank transfer (offline)' });
    expect(p.stripePaymentIntentId).toBeUndefined();
    // Bank with no offline type is still ACH — the portal's.
    await expect(service.recordOffline('deal-1', { amount: 10, method: 'bank' }, caller())).rejects.toThrow(BadRequestException);
  });

  it('refuses a type that disagrees with the method, an online type, or an unknown one', async () => {
    const { service, ledger } = build();
    for (const input of [
      { amount: 10, method: 'cash', methodDetail: 'check' },
      { amount: 10, method: 'card', methodDetail: 'zelle' },
      { amount: 10, method: 'card', methodDetail: 'charge' },
      { amount: 10, method: 'bank', methodDetail: 'bank_transfer' },
      { amount: 10, method: 'other', methodDetail: 'bitcoin' },
      { amount: 10 },
    ]) {
      await expect(service.recordOffline('deal-1', input as any, caller())).rejects.toThrow(BadRequestException);
    }
    expect(ledger.payments.size).toBe(0);
  });

  it('keeps old clients working: a method alone records as before, with no Workiz type stored', async () => {
    const { service } = build();
    const p = await service.recordOffline('deal-1', { amount: 10, method: 'check', reference: '1042' }, caller());
    expect(p).toMatchObject({ method: 'check', reference: '1042' });
    expect(p.methodDetail).toBeUndefined();
    expect(p.methodLabel).toBeUndefined();
  });
});
