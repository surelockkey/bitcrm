import { BadRequestException } from '@nestjs/common';
import type { PaymentSchedule, PaymentScheduleLine, PaymentScheduleStatus, SavePaymentScheduleBody } from '@bitcrm/types';
import { fromCents, toCents } from '../payments/payment-rules';

/** Workiz caps a schedule well below this; it only keeps a request sane. */
export const MAX_SCHEDULED_PAYMENTS = 24;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const NOTE_MAX = 500;

/**
 * Each payment's dollars. A percentage schedule splits the total to the cent
 * and gives the last payment what the others leave, so the payments always add
 * up to the job ($584.93 at 50/50 → $292.47 + $292.46, as Workiz shows it).
 */
function amountsInCents(schedule: Pick<PaymentSchedule, 'method' | 'entries'>, total: number): number[] {
  if (schedule.method === 'amount') return schedule.entries.map((e) => toCents(e.amount ?? 0));
  const totalCents = toCents(total);
  const cents = schedule.entries.map((e) => Math.round((totalCents * (e.percent ?? 0)) / 100));
  if (cents.length) cents[cents.length - 1] = totalCents - cents.slice(0, -1).reduce((s, c) => s + c, 0);
  return cents;
}

/**
 * The schedule against the job's ledger: each payment's dollars, what the job's
 * payments have settled of it (in order, the first payment first), what is
 * left, and where it stands — `paid`, or by its day against `today` (the
 * business's day): `overdue` before it, `due` on it, `future` after.
 */
export function scheduleLines(
  schedule: Pick<PaymentSchedule, 'method' | 'entries'>,
  { total, amountPaid, today }: { total: number; amountPaid: number; today: string },
): PaymentScheduleLine[] {
  let unspent = toCents(Math.max(0, amountPaid));
  return amountsInCents(schedule, total).map((cents, i) => {
    const entry = schedule.entries[i];
    const paidCents = Math.min(cents, unspent);
    unspent -= paidCents;
    const remainingCents = cents - paidCents;
    const status: PaymentScheduleStatus =
      remainingCents <= 0 ? 'paid' : entry.dueDate < today ? 'overdue' : entry.dueDate === today ? 'due' : 'future';
    return {
      id: entry.id,
      index: i + 1,
      ...(schedule.method === 'percent' && { percent: entry.percent }),
      amount: fromCents(cents),
      paid: fromCents(paidCents),
      remaining: fromCents(remainingCents),
      dueDate: entry.dueDate,
      ...(entry.note && { note: entry.note }),
      status,
    };
  });
}

/**
 * What may be saved: one to `MAX_SCHEDULED_PAYMENTS` payments, each with a day
 * and something in it; percentages that make 100, or amounts that make the job
 * total — a schedule that does not add up to the job is not a schedule.
 */
export function validateSchedule(body: SavePaymentScheduleBody, total: number): void {
  if (!(total > 0)) throw new BadRequestException('Add items to the job before scheduling its payments');
  const entries = body.entries ?? [];
  if (!entries.length) throw new BadRequestException('Add at least one payment');
  if (entries.length > MAX_SCHEDULED_PAYMENTS) {
    throw new BadRequestException(`A schedule takes at most ${MAX_SCHEDULED_PAYMENTS} payments`);
  }
  entries.forEach((e, i) => {
    const n = i + 1;
    if (!e.dueDate || !DATE.test(e.dueDate)) throw new BadRequestException(`Payment ${n} needs a due date`);
    if (e.note && e.note.length > NOTE_MAX) throw new BadRequestException(`Payment ${n}'s note is too long`);
    const value = body.method === 'percent' ? e.percent : e.amount;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new BadRequestException(
        body.method === 'percent' ? `Payment ${n} needs a percentage above 0` : `Payment ${n} needs an amount above $0`,
      );
    }
  });
  if (body.method === 'percent') {
    const sum = entries.reduce((s, e) => s + (e.percent ?? 0), 0);
    if (Math.abs(sum - 100) > 0.001) {
      throw new BadRequestException(`The percentages add up to ${Number(sum.toFixed(3))}% — they must make 100%`);
    }
  } else {
    const sum = entries.reduce((s, e) => s + toCents(e.amount ?? 0), 0);
    if (sum !== toCents(total)) {
      throw new BadRequestException(
        `The payments add up to $${fromCents(sum).toFixed(2)} — they must make the job total, $${total.toFixed(2)}`,
      );
    }
  }
}
