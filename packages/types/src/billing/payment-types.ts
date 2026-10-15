import type { PaymentMethod } from '../entities/payment.entity';
import { PAYMENT_REPORT_TYPE_LABELS, type PaymentReportType } from '../entities/payment-report.entity';

/**
 * Workiz's "Add payment" → Payment type, in Workiz's order. Each is a key of
 * `PAYMENT_REPORT_TYPE_LABELS` and is stored on the payment as
 * `methodDetail`, so the Payments report files it under Workiz's own type.
 *
 * `charge` ("Credit charge") is the card typed into Stripe on the spot; every
 * other one is money taken outside BitCRM and keyed in by staff.
 */
export const ADD_PAYMENT_TYPES = [
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
] as const satisfies readonly PaymentReportType[];
export type AddPaymentType = (typeof ADD_PAYMENT_TYPES)[number];

/** The types staff record by hand (`POST …/payments`): all but the card charge. */
export const OFFLINE_PAYMENT_TYPES = [
  'cash',
  'credit',
  'check',
  'bank_transfer_offline',
  'cash_app',
  'consumer_financing',
  'venmo',
  'zelle',
  'debit_offline',
] as const satisfies readonly AddPaymentType[];
export type OfflinePaymentType = (typeof OFFLINE_PAYMENT_TYPES)[number];

/**
 * The coarse `Payment.method` each type is filed under — what the ledger,
 * the commissions report's Cash / Credit / Check columns and the method
 * filter group by. A bank transfer made outside Stripe is `bank`, like ACH;
 * its `methodDetail` is what tells them apart.
 */
export const PAYMENT_TYPE_METHOD: Record<AddPaymentType, PaymentMethod> = {
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
};

/** Workiz's label for the type ("Credit charge", "Bank transfer (offline)"). */
export function paymentTypeLabel(type: AddPaymentType): string {
  return PAYMENT_REPORT_TYPE_LABELS[type];
}

export function isOfflinePaymentType(value: unknown): value is OfflinePaymentType {
  return typeof value === 'string' && (OFFLINE_PAYMENT_TYPES as readonly string[]).includes(value);
}

/** Dollars snapped to the cent, as billing's `round2` does (half-up, without float dust). */
const round2 = (n: number): number => Math.round(Number((n * 100).toFixed(2))) / 100;
const isMoney = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * The card "Service fee" (`PaymentSettings.surchargePercent`): the percent of
 * everything the card pays for — the amount and the tip — rounded half-up to
 * the cent, `round2((amount + tip) × pct / 100)`. 0 when it is off or the
 * input is nonsense. Billing charges exactly this; the screens show it from
 * the same function, so what the client is told is what the card is charged.
 */
export function cardServiceFee(amount: number, tip: number, percent: number): number {
  const base = amount + tip;
  if (!isMoney(base) || !isMoney(percent) || percent <= 0) return 0;
  return round2((base * percent) / 100);
}
