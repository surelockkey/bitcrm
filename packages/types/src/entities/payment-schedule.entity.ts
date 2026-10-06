/**
 * Workiz's Payment schedule: a job's total split into payments due on given
 * days — by percentage or by amount — each sent, viewed and paid on its own.
 * It belongs to the job (sending or paying one needs the job's invoice).
 */

export const PAYMENT_SCHEDULE_METHODS = ['percent', 'amount'] as const;
/** Workiz's "Calculation method": % or $. */
export type PaymentScheduleMethod = (typeof PAYMENT_SCHEDULE_METHODS)[number];

/** One payment as stored: its share, its due day, a note. */
export interface PaymentScheduleEntry {
  id: string;
  /** With `percent`: the share of the job total, 0–100. */
  percent?: number;
  /** With `amount`: dollars. */
  amount?: number;
  /** YYYY-MM-DD (the business's day). */
  dueDate: string;
  note?: string;
}

export interface PaymentSchedule {
  dealId: string;
  method: PaymentScheduleMethod;
  entries: PaymentScheduleEntry[];
  updatedAt: string;
  updatedBy: string;
}

/**
 * Where a payment stands. `paid` once what has been paid on the job covers it
 * (the job's payments settle the schedule in order); otherwise by its day:
 * `overdue` before today, `due` today, `future` after.
 */
export type PaymentScheduleStatus = 'paid' | 'overdue' | 'due' | 'future';

/** One payment as shown: its dollars, what is paid of it, what is left, its status. */
export interface PaymentScheduleLine {
  id: string;
  /** 1-based, as Workiz numbers them ("Payment 1"). */
  index: number;
  percent?: number;
  amount: number;
  paid: number;
  remaining: number;
  dueDate: string;
  note?: string;
  status: PaymentScheduleStatus;
}

/** The schedule as a screen reads it, against the job's ledger. */
export interface PaymentScheduleView {
  dealId: string;
  method: PaymentScheduleMethod;
  /** The job total the schedule splits (the invoice's when there is one). */
  total: number;
  amountPaid: number;
  /** Workiz's "Remaining balance". */
  balanceDue: number;
  lines: PaymentScheduleLine[];
  updatedAt: string;
}

/** `PUT /billing/deals/:dealId/payment-schedule` — the whole schedule, replaced. */
export interface SavePaymentScheduleBody {
  method: PaymentScheduleMethod;
  entries: Array<{ id?: string; percent?: number; amount?: number; dueDate: string; note?: string }>;
}
