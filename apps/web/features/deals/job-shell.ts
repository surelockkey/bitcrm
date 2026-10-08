import { JobSuperStatus } from "@bitcrm/types";
import type { Contact, Deal, InvoiceStatus } from "@bitcrm/types";
import { DEFAULT_TZ } from "@/lib/timezone";
import { invoiceStatusLabel } from "@/features/invoices/lib";
import type { DealTab } from "./deal-tabs";
import { formatMoney } from "./lib";

/**
 * The frame of the job page as Workiz draws it — the title, the "Job name"
 * line, the Actions menu and the grey second line under every tab. What the
 * header and the tab bar decide, decided here so it can be tested without
 * rendering the page.
 */

/* ------------------------------------------------------------------ title */

/**
 * The client half of "Job #5TU7ZA - Dustin Roselle": the job's own name for
 * the client when it has one ("Just here" rename), else the contact's.
 */
export function jobClientName(
  deal: Pick<Deal, "clientName">,
  contact: Pick<Contact, "firstName" | "lastName"> | undefined,
): string {
  const name = deal.clientName ?? contact;
  return name ? `${name.firstName ?? ""} ${name.lastName ?? ""}`.trim() : "";
}

/* --------------------------------------------------------------- job name */

/**
 * The job's free-text name (Workiz "Job name"). The field is new on the API;
 * until a backend sends it the job simply has none.
 */
export function dealJobName(deal: { jobName?: string | null }): string {
  return deal.jobName ?? "";
}

/**
 * What saving the inline "Job name" editor sends: the trimmed name, `null`
 * to clear it, or nothing at all when the name did not change.
 */
export function jobNamePatch(current: string, draft: string): { jobName: string | null } | null {
  const next = draft.trim();
  if (next === current.trim()) return null;
  return { jobName: next || null };
}

/* ---------------------------------------------------------- Actions menu */

/**
 * Workiz's menu holds Job Done, View Work Order, Duplicate Job and Delete
 * Job. "View Work Order" opens the work order that authorized the job, when
 * one did; BitCRM has no duplicate, so that one is not offered at all rather
 * than shown dead.
 */
export type JobAction = "done" | "work_order" | "delete";

export function jobActions({
  superStatus,
  canEdit,
  canDelete,
  workOrderId,
  canViewWorkOrders = false,
}: {
  superStatus: JobSuperStatus;
  /** The same right the status picker needs. */
  canEdit: boolean;
  canDelete: boolean;
  /** The work order the job was authorized by (Platinum clients). */
  workOrderId?: string;
  /** `work_orders.view`. */
  canViewWorkOrders?: boolean;
}): JobAction[] {
  const actions: JobAction[] = [];
  if (canEdit && superStatus !== JobSuperStatus.DONE) actions.push("done");
  if (workOrderId && canViewWorkOrders) actions.push("work_order");
  if (canDelete) actions.push("delete");
  return actions;
}

/* ------------------------------------------------------- Message Client */

/** The last ten digits — "(571) 531-0137" and "+15715310137" are one number. */
const lastTen = (p: string) => p.replace(/\D/g, "").slice(-10);

/**
 * The number "Message Client" texts: the job's own primary phone first (the
 * one Workiz texts), else the client's — and whether the client record
 * carries it, which decides how the first text is addressed.
 */
export function jobChatPhone(
  dealPhones: string[] | undefined,
  contactPhones: string[] | undefined,
): { phone: string | undefined; onContact: boolean } {
  const own = (contactPhones ?? []).filter(Boolean);
  const phone = (dealPhones ?? []).find(Boolean) ?? own[0];
  return { phone, onContact: !phone || own.some((p) => lastTen(p) === lastTen(phone)) };
}

/* -------------------------------------------------------------------- due */

/**
 * The Items tab's "Due" (Workiz `job_amount_due_date`): the invoice's due
 * date once the job has one; before that Workiz fills the job's own day
 * (5TU7ZA, N9YA2L), and a job with no day its creation day.
 */
export function jobDueDate(
  deal: { scheduledDate?: string | null; createdAt?: string | null },
  invoiceDueDate?: string | null,
): string {
  if (invoiceDueDate) return workizDate(invoiceDueDate);
  if (deal.scheduledDate) return workizDate(deal.scheduledDate);
  if (!deal.createdAt) return "";
  const d = new Date(deal.createdAt);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-US", { timeZone: DEFAULT_TZ, month: "numeric", day: "numeric", year: "numeric" });
}

/* ---------------------------------------------------------------- balance */

/**
 * What is still owed, read off the job row alone — for when the payments
 * ledger is not loaded. Same precedence as the backend's `hasBalanceDue`:
 * billing's `amountPaid` once it has spoken, else Workiz's own amount due on
 * an imported job, else the whole total.
 */
export function dealBalance(deal: Pick<Deal, "totals" | "amountPaid">): number {
  const total = deal.totals?.total ?? 0;
  if (!(total > 0)) return 0;
  if (typeof deal.amountPaid === "number") return Math.max(0, total - deal.amountPaid);
  const workizDue = deal.totals?.amountDue;
  if (typeof workizDue === "number") return Math.max(0, workizDue);
  return total;
}

/** "150.00" — the Items tab's grey boxes carry no currency sign. */
export function formatBoxAmount(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ------------------------------------------------------------------ dates */

/** "10/8/2026" — a calendar day as written, never shifted by a time zone. */
export function workizDate(value: string | undefined | null): string {
  const m = value ? /^(\d{4})-(\d{2})-(\d{2})/.exec(value) : null;
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : "";
}

/** "5/4/2026 at 8:59 PM" — a moment on business time (payments, files). */
export function workizDateTime(iso: string | undefined | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-US", { timeZone: DEFAULT_TZ, month: "numeric", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { timeZone: DEFAULT_TZ, hour: "numeric", minute: "2-digit" });
  return `${day} at ${time}`;
}

/* -------------------------------------------------------------- tab bar */

/** "0 estimates", "1 estimate", "3 attachments". */
export function countLabel(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** What the page already holds that the tab bar reads its second lines from. */
export interface TabSublabelContext {
  jobTypeName?: string;
  /** The job's billed total (its items, discount and tax). */
  itemsTotal?: number;
  /** The job ledger's balance; absent until (or unless) the viewer may see payments. */
  balanceDue?: number;
  estimateCount?: number;
  invoiceStatus?: InvoiceStatus;
  attachmentCount?: number;
}

/** The grey line under each tab's name, worded the way Workiz words it. */
export function dealTabSublabel(tab: DealTab, ctx: TabSublabelContext): string {
  switch (tab) {
    case "details":
      return ctx.jobTypeName || "N/A";
    case "items":
      return formatMoney(ctx.itemsTotal ?? 0);
    case "payments":
      return `${formatMoney(ctx.balanceDue ?? ctx.itemsTotal ?? 0)} balance`;
    case "estimates":
      return countLabel(ctx.estimateCount ?? 0, "estimate");
    case "invoice":
      return ctx.invoiceStatus ? invoiceStatusLabel(ctx.invoiceStatus) : "No invoice";
    case "attachments":
      return countLabel(ctx.attachmentCount ?? 0, "attachment");
  }
}
