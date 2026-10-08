import type { Address, Contact } from "@bitcrm/types";
import type { WzPagerState } from "@/components/workiz/pager";
import { DEFAULT_TZ } from "@/lib/timezone";

/**
 * The Clients list as Workiz draws it (`/root/clients/`, captures
 * `pg_contacts_wz_*`): the rules behind the grid's cells, its KPI cards, its
 * Visible fields and its pager. The drawing lives in `contacts-page.tsx` and
 * `clients-grid.tsx`.
 */

/** Workiz's page-size select on the Clients strip (`select._pageSize`); 10 is its default. */
export const CLIENT_PAGE_SIZES = [5, 10, 20, 25, 50, 100] as const;
export const CLIENT_DEFAULT_PAGE_SIZE = 10;

/** How long the Search box waits after the last key: Workiz asks ~1 s after it. */
export const CLIENT_SEARCH_DEBOUNCE_MS = 1000;

export type ClientFieldId = "name" | "address" | "phone" | "created" | "company" | "email" | "source" | "type";
export type ClientFieldIcon = "users" | "location" | "phone" | "calendar" | "email" | "source" | "type";

export interface ClientField {
  id: ClientFieldId;
  label: string;
  icon: ClientFieldIcon;
  /** Starting width; the table spreads spare room over the columns in proportion. */
  width: number;
}

/**
 * Every column the grid can show, in Workiz's panel order: its four USED
 * FIELDS, then ours under UNSELECTED FIELDS (Workiz's own there are its
 * custom fields, "id" and "Service Plan", which we do not have).
 */
export const CLIENT_FIELDS: readonly ClientField[] = [
  { id: "name", label: "Name", icon: "users", width: 348 },
  { id: "address", label: "Address", icon: "location", width: 348 },
  { id: "phone", label: "Phone", icon: "phone", width: 348 },
  { id: "created", label: "Created", icon: "calendar", width: 348 },
  { id: "company", label: "Company", icon: "users", width: 220 },
  { id: "email", label: "Email", icon: "email", width: 240 },
  { id: "source", label: "Ad Source", icon: "source", width: 200 },
  { id: "type", label: "Type", icon: "type", width: 160 },
];

export const DEFAULT_CLIENT_FIELDS: readonly ClientFieldId[] = ["name", "address", "phone", "created"];

const KNOWN = new Set<string>(CLIENT_FIELDS.map((f) => f.id));

/**
 * What came out of storage, made safe: known ids only, each once, in the
 * saved order. An empty or broken value falls back to Workiz's four — a grid
 * with no columns is not a choice anybody made.
 */
export function sanitizeClientFields(raw: unknown): ClientFieldId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_CLIENT_FIELDS];
  const out: ClientFieldId[] = [];
  for (const id of raw) {
    if (typeof id === "string" && KNOWN.has(id) && !out.includes(id as ClientFieldId)) out.push(id as ClientFieldId);
  }
  return out.length ? out : [...DEFAULT_CLIENT_FIELDS];
}

/** "261 E 10th St Mesa, AZ 85203" — Workiz's one-line Address cell (street, unit, city, state zip). */
export function clientAddressLine(a: Address | undefined): string {
  if (!a) return "";
  const street = [a.street, a.unit].map((s) => s?.trim()).filter(Boolean).join(" ");
  const region = [a.state, a.zip].map((s) => s?.trim()).filter(Boolean).join(" ");
  const place = [a.city?.trim(), region].filter(Boolean).join(", ");
  return [street, place].filter(Boolean).join(" ");
}

export type ClientSubline = { kind: "email"; text: string } | { kind: "phone"; phone: string } | null;

/**
 * The one line under the name: the email when the client has one (Workiz:
 * "Quinnipiac University / bspag@qu.edu", though it has a phone too), else
 * the number as a blue tel link ("Deena Galange / (602) 478-3345").
 */
export function clientSubline(c: Pick<Contact, "emails" | "phones">): ClientSubline {
  const email = c.emails?.[0];
  if (email) return { kind: "email", text: email };
  const phone = c.phones?.[0];
  if (phone) return { kind: "phone", phone };
  return null;
}

/** "Thu Oct 08, 2026 04:26 PM" — the Created cell, on the account's clock. Empty for a bad date. */
export function formatClientCreated(iso: string | undefined, tz: string = DEFAULT_TZ): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday} ${parts.month} ${parts.day}, ${parts.year} ${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
}

/** "$495,463.7" — Workiz's card money: thousands separators, at most two decimals, no trailing zero. */
export function kpiMoney(n: number): string {
  return `$${(Number.isFinite(n) ? n : 0).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

/** "370,358"; a count that stopped on a ceiling reads "5,000+". */
export function kpiCount(n: number, atLeast = false): string {
  return `${n.toLocaleString("en-US")}${atLeast ? "+" : ""}`;
}

/**
 * The footer's numbers over the search service's pages. The search answers a
 * page and the total, so the footer reads exactly as the list's does. A total
 * the page could not vouch for (the rows were narrowed by tags afterwards) is
 * left out: "Showing 1 to 2 results", "Page 1".
 */
export function searchPager({
  page,
  size,
  total,
  rows,
  setPage,
  fetching = false,
}: {
  page: number;
  size: number;
  total: number | undefined;
  rows: number;
  setPage: (page: number) => void;
  fetching?: boolean;
}): WzPagerState {
  const from = rows ? (page - 1) * size + 1 : 0;
  const to = rows ? from + rows - 1 : 0;
  const totalPages = typeof total === "number" ? Math.max(1, Math.ceil(total / size)) : undefined;
  return {
    page,
    from,
    to,
    total,
    totalPages,
    canPrev: page > 1,
    canNext: totalPages === undefined ? rows === size : page < totalPages,
    isFetching: fetching,
    prev: () => setPage(Math.max(1, page - 1)),
    next: () => setPage(page + 1),
  };
}

/** One KPI card over the list (`WzStatCard`). */
export interface ClientKpi {
  key: "clients" | "due" | "pastDue" | "estimates";
  value: string;
  caption: string;
  tone: "ink" | "orange" | "red";
  /** The card's accessible name — its caption without the numbers. */
  label: string;
}

const clientsWord = (n: number) => `${n.toLocaleString("en-US")} client${n === 1 ? "" : "s"}`;

/**
 * Workiz's four cards (pg_contacts_wz_01_default): "370,358 / Clients",
 * "$495,463.7 / Due from 335 clients" (every open balance, past due
 * included), "$121,011.91 / Past due from 260 clients", "296 / Estimates
 * Pending $9,266,476.39". A card whose numbers the viewer may not see (no
 * `invoices.view`, no `estimates.view`) is left out, not shown empty. An
 * older server that does not count the owing clients yet makes the caption
 * plain "Due" / "Past due".
 */
export function clientKpis({
  clients,
  invoices,
  estimates,
}: {
  clients?: { total: number; atLeast?: boolean };
  invoices?: { dueAmount: number; overdueAmount: number; dueClientCount?: number; overdueClientCount?: number };
  estimates?: { count: number; amount: number };
}): ClientKpi[] {
  const out: ClientKpi[] = [];
  if (clients) {
    out.push({ key: "clients", value: kpiCount(clients.total, clients.atLeast), caption: "Clients", tone: "ink", label: "Clients" });
  }
  if (invoices) {
    out.push({
      key: "due",
      value: kpiMoney(Math.round((invoices.dueAmount + invoices.overdueAmount) * 100) / 100),
      caption: typeof invoices.dueClientCount === "number" ? `Due from ${clientsWord(invoices.dueClientCount)}` : "Due",
      tone: "orange",
      label: "Due",
    });
    out.push({
      key: "pastDue",
      value: kpiMoney(invoices.overdueAmount),
      caption:
        typeof invoices.overdueClientCount === "number" ? `Past due from ${clientsWord(invoices.overdueClientCount)}` : "Past due",
      tone: "red",
      label: "Past due",
    });
  }
  if (estimates) {
    out.push({
      key: "estimates",
      value: kpiCount(estimates.count),
      caption: `Estimates Pending ${kpiMoney(estimates.amount)}`,
      tone: "ink",
      label: "Estimates Pending",
    });
  }
  return out;
}
