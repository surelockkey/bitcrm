import type { Address, Contact, Deal, Estimate, Invoice } from "@bitcrm/types";
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
 */
export function clientKpis(invoices: Invoice[], estimates: Estimate[], today: string): ClientKpis {
  let pastDue = 0;
  let due = 0;
  let totalRevenue = 0;
  for (const inv of invoices) {
    const balance = Math.max(0, inv.totals?.balanceDue ?? 0);
    due += balance;
    if (balance > 0 && inv.dueDate < today) pastDue += balance;
    totalRevenue += inv.totals?.total ?? 0;
  }
  return { pastDue: round2(pastDue), due: round2(due), totalRevenue: round2(totalRevenue), estimates: estimates.length };
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
}

/**
 * One row per distinct address (street + unit + zip, case-insensitive): the
 * client's own list, the billing address, and any job address not on the
 * client. The service address leads; the rest keep the order they came in.
 */
export function clientAddressRows(contact: Pick<Contact, "addresses" | "billingAddress">, deals: Deal[]): ClientAddressRow[] {
  const rows = new Map<string, ClientAddressRow>();
  const add = (address: Address, flags: Partial<Pick<ClientAddressRow, "isService" | "isBilling">> = {}) => {
    const key = addressKey(address);
    const row = rows.get(key);
    if (row) {
      row.isService ||= !!flags.isService;
      row.isBilling ||= !!flags.isBilling;
      return row;
    }
    const fresh: ClientAddressRow = { key, address, isService: !!flags.isService, isBilling: !!flags.isBilling, jobs: 0, total: 0 };
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
  for (const inv of invoices) map.set(inv.dealId, Math.max(0, inv.totals?.balanceDue ?? 0));
  return map;
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
