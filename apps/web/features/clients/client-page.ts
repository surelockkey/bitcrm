import { COUNTED_PAYMENT_STATUSES, type Address, type Contact, type Deal, type Estimate, type Invoice, type Payment } from "@bitcrm/types";
import { formatPhoneWithExtension } from "@/lib/phone";
import { workizScheduleCell } from "@/features/deals/schedule-cell";
import { addressKey } from "./lib";

/** Workiz's four cards over the client's documents: Past due, Due, Total revenue, Estimates. */
export interface ClientKpis {
  pastDue: number;
  due: number;
  totalRevenue: number;
  estimates: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * `today` is the account's "YYYY-MM-DD". An invoice is past due the day
 * AFTER its due date; one due today still only counts as due.
 *
 * TOTAL REVENUE is what the client has paid — Workiz's number is the sum of
 * the client's payments (13 clients checked against the export: it equals
 * the payments, not invoiced − due). With the payments in hand (`payments`,
 * for a viewer who may read them) it is their settled money less refunds;
 * without them, what the invoices say was paid on them.
 */
export function clientKpis(invoices: Invoice[], estimates: Estimate[], today: string, payments?: Payment[]): ClientKpis {
  let pastDue = 0;
  let due = 0;
  let paidOnInvoices = 0;
  for (const inv of invoices) {
    const balance = Math.max(0, inv.totals?.balanceDue ?? 0);
    due += balance;
    if (balance > 0 && inv.dueDate < today) pastDue += balance;
    paidOnInvoices += inv.totals?.amountPaid ?? 0;
  }
  const totalRevenue = payments
    ? payments
        .filter((p) => COUNTED_PAYMENT_STATUSES.includes(p.status))
        .reduce((sum, p) => sum + (p.amount ?? 0) - (p.refundedAmount ?? 0), 0)
    : paidOnInvoices;
  return { pastDue: round2(pastDue), due: round2(due), totalRevenue: round2(totalRevenue), estimates: estimates.length };
}

const GROUPED = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Workiz's grid figures: "67,291.00" — grouped, two decimals, no currency sign. */
export function wzMoney(n: number): string {
  return GROUPED.format(Math.round((n + Number.EPSILON) * 100) / 100);
}

/**
 * Workiz's phone on the client card: "(505) 228 - 5946", the dash spaced out;
 * a foreign number keeps its international grouping; an extension follows.
 */
export function wzPhone(phone: string, extension?: string): string {
  return formatPhoneWithExtension(phone, extension).replace(/^(\(\d{3}\) \d{3})-(\d{4})/, "$1 - $2");
}

/** One line of Workiz's Addresses tab. */
export interface ClientAddressRow {
  key: string;
  address: Address;
  /** The client's service address — `addresses[0]`, what the card shows. */
  isService: boolean;
  isBilling: boolean;
  /** Jobs of this client at this address, among the jobs in hand. */
  jobs: number;
  /** Those jobs' totals added up. */
  total: number;
  /** What is still owed on those jobs' invoices (Workiz's Due). */
  due: number;
  /** The part of it past its due date (Workiz's past_due). */
  pastDue: number;
}

/**
 * One row per distinct address (street + unit + zip, case-insensitive): the
 * client's own list, the billing address, and any job address not on the
 * client. The service address leads; the rest keep the order they came in.
 * `balances` (dealId → due / past due) adds up Workiz's Due and past_due.
 */
export function clientAddressRows(
  contact: Pick<Contact, "addresses" | "billingAddress">,
  deals: Deal[],
  balances?: { due: Map<string, number>; pastDue: Map<string, number> },
): ClientAddressRow[] {
  const rows = new Map<string, ClientAddressRow>();
  const add = (address: Address, flags: Partial<Pick<ClientAddressRow, "isService" | "isBilling">> = {}) => {
    const key = addressKey(address);
    const row = rows.get(key);
    if (row) {
      row.isService ||= !!flags.isService;
      row.isBilling ||= !!flags.isBilling;
      return row;
    }
    const fresh: ClientAddressRow = {
      key,
      address,
      isService: !!flags.isService,
      isBilling: !!flags.isBilling,
      jobs: 0,
      total: 0,
      due: 0,
      pastDue: 0,
    };
    rows.set(key, fresh);
    return fresh;
  };

  contact.addresses.forEach((a, i) => add(a, { isService: i === 0 }));
  if (contact.billingAddress) add(contact.billingAddress, { isBilling: true });
  for (const deal of deals) {
    if (!deal.address?.street) continue;
    const row = add(deal.address);
    row.jobs += 1;
    row.total = round2(row.total + (deal.totals?.total ?? 0));
    row.due = round2(row.due + (balances?.due.get(deal.id) ?? 0));
    row.pastDue = round2(row.pastDue + (balances?.pastDue.get(deal.id) ?? 0));
  }
  return [...rows.values()];
}

/** The tab's search box: street, unit, city, state and zip, any case. */
export function filterAddressRows(rows: ClientAddressRow[], query: string): ClientAddressRow[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((r) => {
    const a = r.address;
    return [a.street, a.unit, a.city, a.state, a.zip].some((part) => part?.toLowerCase().includes(q));
  });
}

/** dealId → the balance still due on that job's invoice (Workiz's Amount Due column). */
export function amountDueByDeal(invoices: Invoice[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const inv of invoices) {
    // A client invoice (no job) has no job row to show a balance on.
    if (inv.dealId) map.set(inv.dealId, Math.max(0, inv.totals?.balanceDue ?? 0));
  }
  return map;
}

/**
 * dealId → the part of its invoice's balance that is past due (Workiz's Past
 * Due column): the whole balance once the due date has passed, else 0.
 */
export function pastDueByDeal(invoices: Invoice[], today: string): Map<string, number> {
  const map = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.dealId) continue;
    const balance = Math.max(0, inv.totals?.balanceDue ?? 0);
    map.set(inv.dealId, inv.dueDate < today ? balance : 0);
  }
  return map;
}

/**
 * Workiz's Job Date column: the visit on the account's clock ("Mon Sep 21,
 * 2026 08:00 pm") — a visit is stored on the clock of the zone it was booked
 * in (`zone`: the job's own, else its service area's; absent = the
 * account's), the same conversion as the jobs list's Scheduled cell.
 */
export function clientJobDate(deal: Pick<Deal, "scheduledDate" | "scheduledTimeSlot" | "allDay">, zone: string | undefined, accountZone: string): string {
  return workizScheduleCell(
    { scheduledDate: deal.scheduledDate, scheduledTimeSlot: deal.allDay ? undefined : deal.scheduledTimeSlot, zone },
    accountZone,
  ).when;
}

const DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Workiz's Job Date column: "Fri Oct 09, 2026 11:00 am"; an all-day job keeps the date alone. */
export function jobDateLabel(deal: Pick<Deal, "scheduledDate" | "scheduledTimeSlot" | "allDay">): string {
  if (!deal.scheduledDate) return "Unscheduled";
  const [y, m, d] = deal.scheduledDate.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = `${DAY[date.getUTCDay()]} ${MONTH[m - 1]} ${String(d).padStart(2, "0")}, ${y}`;
  const start = deal.allDay ? undefined : deal.scheduledTimeSlot?.split("-")[0];
  if (!start) return day;
  const [hh, mm] = start.split(":").map(Number);
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${day} ${h12}:${String(mm).padStart(2, "0")} ${hh < 12 ? "am" : "pm"}`;
}

/**
 * Workiz's Jobs tab order: newest visit first, undated jobs at the end, a
 * tie broken by creation (newest first). The card has every job of the
 * client in hand, so it sorts them itself — the API's contact index is by
 * creation, and a schedule sort there is not a thing.
 */
export function byJobDateDesc(a: Pick<Deal, "scheduledDate" | "createdAt">, b: Pick<Deal, "scheduledDate" | "createdAt">): number {
  const da = a.scheduledDate ?? "";
  const db = b.scheduledDate ?? "";
  if (da !== db) {
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }
  return (b.createdAt ?? "").localeCompare(a.createdAt ?? "");
}
