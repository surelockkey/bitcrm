import type {
  PaymentScheduleLine,
  PaymentScheduleMethod,
  PaymentScheduleView,
  SavePaymentScheduleBody,
} from "@bitcrm/types";
import { addDaysYmd } from "@/features/billing/dates";
import { formatMoney } from "@/features/billing/lib";

/*
 * Workiz's "Add payment schedule" window on the web (help centre article
 * 38044340324753): the job total split by % or $, "Add from 2 up to 12
 * payments", each with a due date and a note. Inputs stay as typed (strings);
 * billing does the authoritative sums and refuses the same things
 * (`payment-schedule.rules.ts`) — these only show the same dollars and say
 * what is wrong before Save. Ported from the mobile app (bitcrm-mobile
 * feat/payment-schedule, src/features/finance/payment-schedule.ts).
 */

/** Workiz's window: "Add from 2 up to 12 payments" (billing takes 1–24). */
export const MIN_SCHEDULED_PAYMENTS = 2;
export const MAX_SCHEDULED_PAYMENTS = 12;

export interface DraftEntry {
  /** Stable for React while editing. */
  key: string;
  /** A payment billing already has — kept so it stays the same payment. */
  id?: string;
  percent: string;
  amount: string;
  /** YYYY-MM-DD, or "" when cleared. */
  dueDate: string;
  note: string;
}

export interface ScheduleDraft {
  method: PaymentScheduleMethod;
  entries: DraftEntry[];
}

let seq = 0;
const newKey = () => `new-${Date.now().toString(36)}-${(seq++).toString(36)}`;

const toCents = (dollars: number) => Math.round(Number((dollars * 100).toFixed(2)));
const fromCents = (cents: number) => Math.round(cents) / 100;
/** "50", "33.33" — what the field shows for a share. */
const pctText = (n: number) => String(Number(n.toFixed(2)));
const usdText = (n: number) => n.toFixed(2);
const num = (s: string) => (s.trim() === "" ? NaN : Number(s));

/** 100 split into `n` shares of two decimals, the last taking the rest (33.33, 33.33, 33.34). */
function evenPercents(n: number): string[] {
  const base = Math.floor(10000 / n) / 100;
  return Array.from({ length: n }, (_, i) => pctText(i < n - 1 ? base : Number((100 - base * (n - 1)).toFixed(2))));
}

/** Two payments of half the total: the first due today, the second the day after. */
export function defaultDraft(todayYmd: string): ScheduleDraft {
  return {
    method: "percent",
    entries: [
      { key: newKey(), percent: "50", amount: "", dueDate: todayYmd, note: "" },
      { key: newKey(), percent: "50", amount: "", dueDate: addDaysYmd(todayYmd, 1), note: "" },
    ],
  };
}

/** The schedule billing holds, opened for editing. */
export function fromView(view: PaymentScheduleView): ScheduleDraft {
  return {
    method: view.method,
    entries: view.lines.map((l) => ({
      key: l.id,
      id: l.id,
      percent: view.method === "percent" && l.percent !== undefined ? pctText(l.percent) : "",
      amount: view.method === "amount" ? usdText(l.amount) : "",
      dueDate: l.dueDate,
      note: l.note ?? "",
    })),
  };
}

export const canAddEntry = (draft: ScheduleDraft) => draft.entries.length < MAX_SCHEDULED_PAYMENTS;

/**
 * "+ Add payment": by %, every payment re-split evenly; by $, the new one takes
 * what is still unscheduled. It falls due the day after the last.
 */
export function addEntry(draft: ScheduleDraft, total: number): ScheduleDraft {
  if (!canAddEntry(draft)) return draft;
  const last = draft.entries[draft.entries.length - 1];
  const dueDate = last?.dueDate ? addDaysYmd(last.dueDate, 1) : "";
  if (draft.method === "percent") {
    const shares = evenPercents(draft.entries.length + 1);
    return {
      ...draft,
      entries: [...draft.entries, { key: newKey(), percent: "", amount: "", dueDate, note: "" }].map((e, i) => ({
        ...e,
        percent: shares[i],
      })),
    };
  }
  const scheduled = draft.entries.reduce((s, e) => s + (toCents(num(e.amount)) || 0), 0);
  const left = Math.max(0, toCents(total) - scheduled);
  return {
    ...draft,
    entries: [...draft.entries, { key: newKey(), percent: "", amount: usdText(fromCents(left)), dueDate, note: "" }],
  };
}

/** The × on a payment: by %, the rest re-split evenly. */
export function removeEntry(draft: ScheduleDraft, key: string): ScheduleDraft {
  const entries = draft.entries.filter((e) => e.key !== key);
  if (draft.method !== "percent" || !entries.length) return { ...draft, entries };
  const shares = evenPercents(entries.length);
  return { ...draft, entries: entries.map((e, i) => ({ ...e, percent: shares[i] })) };
}

function amountsInCents(draft: ScheduleDraft, total: number): number[] {
  if (draft.method === "amount") return draft.entries.map((e) => toCents(num(e.amount)) || 0);
  const totalCents = toCents(total);
  const cents = draft.entries.map((e) => Math.round((totalCents * (num(e.percent) || 0)) / 100));
  if (cents.length) cents[cents.length - 1] = totalCents - cents.slice(0, -1).reduce((s, c) => s + c, 0);
  return cents;
}

/**
 * Each payment's dollars as billing will work them out — a percentage split
 * to the cent, the last taking the rest — and what is already paid settled on
 * them in order (the first payment first).
 */
export function previewLines(draft: ScheduleDraft, total: number, amountPaid: number): Array<{ amount: number; paid: number; remaining: number }> {
  let unspent = toCents(Math.max(0, amountPaid));
  return amountsInCents(draft, total).map((cents) => {
    const paid = Math.min(cents, unspent);
    unspent -= paid;
    return { amount: fromCents(cents), paid: fromCents(paid), remaining: fromCents(cents - paid) };
  });
}

/** "Calculation method" % ↔ $: the same split, written the other way. */
export function switchMethod(draft: ScheduleDraft, method: PaymentScheduleMethod, total: number): ScheduleDraft {
  if (method === draft.method) return draft;
  if (method === "amount") {
    const amounts = previewLines(draft, total, 0).map((l) => l.amount);
    return { method, entries: draft.entries.map((e, i) => ({ ...e, amount: usdText(amounts[i]) })) };
  }
  const totalCents = toCents(total);
  const shares = draft.entries.map((e) => (totalCents ? Number(((toCents(num(e.amount) || 0) / totalCents) * 100).toFixed(2)) : 0));
  if (shares.length) shares[shares.length - 1] = Number((100 - shares.slice(0, -1).reduce((s, p) => s + p, 0)).toFixed(2));
  return { method, entries: draft.entries.map((e, i) => ({ ...e, percent: pctText(shares[i]) })) };
}

/** What billing (or Workiz's window) would refuse, in its words — or null. */
export function draftProblem(draft: ScheduleDraft, total: number): string | null {
  if (!(total > 0)) return "Add items to the job before scheduling its payments";
  if (draft.entries.length < MIN_SCHEDULED_PAYMENTS) return `Add at least ${MIN_SCHEDULED_PAYMENTS} payments`;
  for (const [i, e] of draft.entries.entries()) {
    if (!e.dueDate) return `Payment ${i + 1} needs a due date`;
    const v = num(draft.method === "percent" ? e.percent : e.amount);
    if (!(v > 0)) {
      return draft.method === "percent" ? `Payment ${i + 1} needs a percentage above 0` : `Payment ${i + 1} needs an amount above $0`;
    }
  }
  if (draft.method === "percent") {
    const sum = draft.entries.reduce((s, e) => s + num(e.percent), 0);
    if (Math.abs(sum - 100) > 0.001) return `The percentages add up to ${Number(sum.toFixed(3))}% — they must make 100%`;
  } else {
    const sum = draft.entries.reduce((s, e) => s + toCents(num(e.amount)), 0);
    if (sum !== toCents(total)) {
      return `The payments add up to ${formatMoney(fromCents(sum))} — they must make the job total, ${formatMoney(total)}`;
    }
  }
  return null;
}

/** The draft as billing takes it (`PUT /billing/deals/:dealId/payment-schedule`). */
export function toBody(draft: ScheduleDraft): SavePaymentScheduleBody {
  return {
    method: draft.method,
    entries: draft.entries.map((e) => ({
      ...(e.id && { id: e.id }),
      ...(draft.method === "percent" ? { percent: num(e.percent) } : { amount: num(e.amount) }),
      dueDate: e.dueDate,
      ...(e.note.trim() && { note: e.note.trim() }),
    })),
  };
}

/**
 * The window's strip: REMAINING (the job's balance), JOB TOTAL, NEXT DUE (the
 * first payment not yet covered, what is left of it and its day) and the
 * payments ("1/3 PAYMENTS" once one is paid).
 */
export function scheduleSummary(
  draft: ScheduleDraft,
  total: number,
  amountPaid: number,
): { remaining: number; total: number; next: { amount: number; dueDate: string } | null; paidCount: number; count: number } {
  const lines = previewLines(draft, total, amountPaid);
  const nextAt = lines.findIndex((l) => l.remaining > 0);
  return {
    remaining: fromCents(Math.max(0, toCents(total) - toCents(Math.max(0, amountPaid)))),
    total,
    next: nextAt >= 0 ? { amount: lines[nextAt].remaining, dueDate: draft.entries[nextAt].dueDate } : null,
    paidCount: lines.filter((l) => l.amount > 0 && l.remaining <= 0).length,
    count: lines.length,
  };
}

/**
 * A payment's tag in the schedule table (hc-38044340324753-07): Paid green,
 * Partial blue, Due orange, Future grey — and ours, Overdue red.
 */
export function scheduleStatus(line: PaymentScheduleLine): { label: string; className: string } {
  if (line.status === "paid") return { label: "Paid", className: "bg-wz-tag-success" };
  if (line.paid > 0) return { label: "Partial", className: "bg-wz-link" };
  if (line.status === "overdue") return { label: "Overdue", className: "bg-wz-error" };
  if (line.status === "due") return { label: "Due", className: "bg-[#f5ad0b]" };
  return { label: "Future", className: "bg-wz-outline" };
}
