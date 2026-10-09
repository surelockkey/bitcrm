import { ClientType, type Company } from "@bitcrm/types";
import type { WzFilterGroup, WzFilterPick } from "@/components/workiz/filter-select";
import { localGridView, type WzGridColumn, type WzGridSort, type WzGridView } from "@/components/workiz/local-grid";
import { CLIENT_DEFAULT_PAGE_SIZE, CLIENT_PAGE_SIZES, kpiCount } from "./clients-list";
import { clientTypeLabel, primaryPhone, searchCompanies } from "./lib";

/**
 * The Companies list. Workiz has no companies — a Workiz client's "Company
 * name" is a field — so the list is drawn as Workiz's Clients list
 * (`/root/clients/`, captures `pg_contacts_wz_*`), our `/contacts` sibling:
 * the KPI cards, "Filter results", the grey strip, the grid and the pager.
 * The rules live here; the drawing in `companies-page.tsx` and
 * `companies-table.tsx`.
 *
 * Every company is in hand (the CRM pages them out to the end), so search,
 * filters, order and pages are all worked out in the browser.
 */

/** Workiz's page sizes on a list strip; 10 is its default. */
export const COMPANY_PAGE_SIZES = CLIENT_PAGE_SIZES;
export const COMPANY_DEFAULT_PAGE_SIZE = CLIENT_DEFAULT_PAGE_SIZE;

export type CompanyFieldId = "name" | "type" | "address" | "phone" | "created" | "website" | "email";
export type CompanyFieldIcon = "company" | "type" | "location" | "phone" | "calendar" | "website" | "email";

export interface CompanyField {
  id: CompanyFieldId;
  label: string;
  icon: CompanyFieldIcon;
  /** Starting width; the table spreads spare room over the columns in proportion. */
  width: number;
  /** The header orders the rows. Workiz's Address header does not. */
  sortable: boolean;
}

/**
 * Every column the grid can show, in the panel's order: Workiz's Clients
 * columns with the company's type after the name, then ours (Website, Email)
 * under UNSELECTED FIELDS.
 */
export const COMPANY_FIELDS: readonly CompanyField[] = [
  { id: "name", label: "Name", icon: "company", width: 348, sortable: true },
  { id: "type", label: "Type", icon: "type", width: 180, sortable: true },
  { id: "address", label: "Address", icon: "location", width: 348, sortable: false },
  { id: "phone", label: "Phone", icon: "phone", width: 260, sortable: true },
  { id: "created", label: "Created", icon: "calendar", width: 300, sortable: true },
  { id: "website", label: "Website", icon: "website", width: 240, sortable: true },
  { id: "email", label: "Email", icon: "email", width: 240, sortable: true },
];

export const DEFAULT_COMPANY_FIELDS: readonly CompanyFieldId[] = ["name", "type", "address", "phone", "created"];

const KNOWN = new Set<string>(COMPANY_FIELDS.map((f) => f.id));

/** What came out of storage, made safe: known ids, each once, in order; else the defaults. */
export function sanitizeCompanyFields(raw: unknown): CompanyFieldId[] {
  if (!Array.isArray(raw)) return [...DEFAULT_COMPANY_FIELDS];
  const out: CompanyFieldId[] = [];
  for (const id of raw) {
    if (typeof id === "string" && KNOWN.has(id) && !out.includes(id as CompanyFieldId)) out.push(id as CompanyFieldId);
  }
  return out.length ? out : [...DEFAULT_COMPANY_FIELDS];
}

/** Workiz opens its Clients list newest first. */
export const COMPANY_DEFAULT_SORT: WzGridSort = { id: "created", dir: "desc" };

const TYPE_ORDER = [ClientType.RESIDENTIAL, ClientType.COMMERCIAL, ClientType.GOVERNMENT] as const;

/** "Filter results": TYPE (any of the picked) and PLATINUM, side by side. */
export function companyFilterGroups(): WzFilterGroup[] {
  return [
    {
      id: "type",
      title: "Type",
      chipPrefix: "type",
      options: TYPE_ORDER.map((t) => ({ value: t, label: clientTypeLabel(t) })),
    },
    {
      id: "platinum",
      title: "Platinum",
      chipPrefix: "platinum",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
  ];
}

/** Any pick inside a group matches (Workiz's OR); every group with picks must match. */
export function filterCompanies(companies: readonly Company[], picks: readonly WzFilterPick[]): Company[] {
  const types = picks.filter((p) => p.group === "type").map((p) => p.value);
  const platinum = picks.filter((p) => p.group === "platinum").map((p) => p.value);
  return companies.filter(
    (c) =>
      (!types.length || types.includes(c.clientType)) &&
      (!platinum.length || platinum.includes(c.isPlatinum ? "yes" : "no")),
  );
}

export type CompanyCardKey = "all" | "commercial" | "government" | "platinum";

/** One card over the list (`WzKpiCard`), and the filter it sets. */
export interface CompanyKpi {
  key: CompanyCardKey;
  value: string;
  caption: string;
  label: string;
}

/** The filter each card stands for; "Companies" clears it. */
export function companyCardPicks(key: CompanyCardKey): WzFilterPick[] {
  switch (key) {
    case "all":
      return [];
    case "commercial":
      return [{ group: "type", value: ClientType.COMMERCIAL }];
    case "government":
      return [{ group: "type", value: ClientType.GOVERNMENT }];
    case "platinum":
      return [{ group: "platinum", value: "yes" }];
  }
}

const CARD_KEYS: readonly CompanyCardKey[] = ["all", "commercial", "government", "platinum"];

const samePicks = (a: readonly WzFilterPick[], b: readonly WzFilterPick[]) =>
  a.length === b.length && a.every((p) => b.some((q) => q.group === p.group && q.value === p.value));

/**
 * The card whose filter is exactly the current one. None while nothing is
 * filtered — Workiz's cards turn orange only once one is clicked
 * (pg_estimates_wz_01_default vs _06_card_won) — nor for a filter no card
 * stands for.
 */
export function selectedCompanyCard(picks: readonly WzFilterPick[]): CompanyCardKey | null {
  if (!picks.length) return null;
  return CARD_KEYS.find((k) => samePicks(companyCardPicks(k), picks)) ?? null;
}

/**
 * The four cards: every company, the commercial and the government ones, and
 * the platinum accounts — counts, as Workiz's "370,358 / Clients". Workiz's
 * money cards (Due, Past due) have no per-company numbers behind them here.
 */
export function companyKpis(companies: readonly Company[]): CompanyKpi[] {
  const count = (key: CompanyCardKey) => filterCompanies(companies, companyCardPicks(key)).length;
  const card = (key: CompanyCardKey, caption: string): CompanyKpi => ({ key, value: kpiCount(count(key)), caption, label: caption });
  return [card("all", "Companies"), card("commercial", "Commercial"), card("government", "Government"), card("platinum", "Platinum")];
}

const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "");

/** What each header orders by. */
const SORT_COLUMNS: readonly WzGridColumn<Company>[] = [
  { id: "name", label: "Name", render: () => null, sortValue: (c) => c.title },
  { id: "type", label: "Type", render: () => null, sortValue: (c) => clientTypeLabel(c.clientType) },
  { id: "phone", label: "Phone", render: () => null, sortValue: (c) => digits(primaryPhone(c)) || undefined },
  { id: "created", label: "Created", render: () => null, sortValue: (c) => c.createdAt || undefined },
  { id: "website", label: "Website", render: () => null, sortValue: (c) => c.website || undefined },
  { id: "email", label: "Email", render: () => null, sortValue: (c) => c.emails[0] },
];

/**
 * The rows on screen: the search (name, address, email, phone digits), then
 * the filter's picks, in the header's order (blanks last), cut to the page —
 * with the footer's numbers.
 */
export function companiesView(
  companies: readonly Company[],
  { query, picks, sort, page, size }: { query: string; picks: readonly WzFilterPick[]; sort: WzGridSort | null; page: number; size: number },
): WzGridView<Company> {
  const found = filterCompanies(searchCompanies([...companies], query), picks);
  return localGridView(found, SORT_COLUMNS, { query: "", sort, page, size });
}
