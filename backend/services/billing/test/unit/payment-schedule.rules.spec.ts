import { BadRequestException } from '@nestjs/common';
import type { PaymentSchedule } from '@bitcrm/types';
import { scheduleLines, validateSchedule } from 'src/payment-schedule/payment-schedule.rules';

const schedule = (over: Partial<PaymentSchedule> = {}): PaymentSchedule => ({
  dealId: 'd1',
  method: 'percent',
  entries: [
    { id: 'p1', percent: 50, dueDate: '2026-10-06' },
    { id: 'p2', percent: 50, dueDate: '2026-10-07' },
  ],
  updatedAt: '2026-10-06T12:00:00.000Z',
  updatedBy: 'u1',
  ...over,
});

/**
 * Workiz's Payment schedule (captures 2026-10-06): a $584.93 job split 50/50
 * reads $292.47 then $292.46 — the cents a percentage cannot split go to the
 * last payment, so the payments always add up to the job. What has been paid
 * on the job settles them in order; the rest stand by their day.
 */
describe('payment schedule — the lines', () => {
  it("splits a percentage schedule to the cent, the last payment taking what is left", () => {
    const lines = scheduleLines(schedule(), { total: 584.93, amountPaid: 0, today: '2026-10-06' });
    expect(lines.map((l) => l.amount)).toEqual([292.47, 292.46]);
    expect(lines.map((l) => l.index)).toEqual([1, 2]);
  });

  it('reads Due on its day and Future after it, as Workiz does', () => {
    const lines = scheduleLines(schedule(), { total: 584.93, amountPaid: 0, today: '2026-10-06' });
    expect(lines.map((l) => l.status)).toEqual(['due', 'future']);
  });

  it('reads Overdue once its day has passed unpaid', () => {
    const lines = scheduleLines(schedule(), { total: 584.93, amountPaid: 0, today: '2026-10-08' });
    expect(lines.map((l) => l.status)).toEqual(['overdue', 'overdue']);
  });

  it("settles the payments in order with what the job has been paid", () => {
    const lines = scheduleLines(schedule(), { total: 584.93, amountPaid: 300, today: '2026-10-06' });
    expect(lines[0]).toMatchObject({ status: 'paid', paid: 292.47, remaining: 0 });
    expect(lines[1]).toMatchObject({ status: 'future', paid: 7.53, remaining: 284.93 });
  });

  it('keeps an amount schedule at its dollars', () => {
    const lines = scheduleLines(
      schedule({ method: 'amount', entries: [{ id: 'a', amount: 100, dueDate: '2026-10-06' }, { id: 'b', amount: 484.93, dueDate: '2026-11-06' }] }),
      { total: 584.93, amountPaid: 0, today: '2026-10-06' },
    );
    expect(lines.map((l) => l.amount)).toEqual([100, 484.93]);
  });
});

describe('payment schedule — what may be saved', () => {
  it('takes percentages that add up to 100', () => {
    expect(() =>
      validateSchedule({ method: 'percent', entries: [{ percent: 50, dueDate: '2026-10-06' }, { percent: 50, dueDate: '2026-10-07' }] }, 584.93),
    ).not.toThrow();
  });

  it('refuses percentages that do not add up to 100', () => {
    expect(() =>
      validateSchedule({ method: 'percent', entries: [{ percent: 50, dueDate: '2026-10-06' }, { percent: 40, dueDate: '2026-10-07' }] }, 584.93),
    ).toThrow(BadRequestException);
  });

  it('refuses amounts that do not add up to the job total', () => {
    expect(() =>
      validateSchedule({ method: 'amount', entries: [{ amount: 100, dueDate: '2026-10-06' }, { amount: 100, dueDate: '2026-10-07' }] }, 584.93),
    ).toThrow(/584\.93/);
  });

  it('refuses a payment without a day, or with nothing in it', () => {
    expect(() => validateSchedule({ method: 'percent', entries: [{ percent: 100, dueDate: '' }] }, 100)).toThrow(BadRequestException);
    expect(() =>
      validateSchedule({ method: 'percent', entries: [{ percent: 0, dueDate: '2026-10-06' }, { percent: 100, dueDate: '2026-10-07' }] }, 100),
    ).toThrow(BadRequestException);
  });

  it('refuses a schedule for a job with nothing to pay', () => {
    expect(() => validateSchedule({ method: 'percent', entries: [{ percent: 100, dueDate: '2026-10-06' }] }, 0)).toThrow(/items/i);
  });
});
