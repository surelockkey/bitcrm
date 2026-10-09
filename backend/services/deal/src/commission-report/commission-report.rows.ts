import {
  COMMISSION_REPORT_TOTAL_KEYS,
  DEFAULT_TIMEZONE,
  type CommissionConfig,
  type CommissionReportBy,
  type CommissionReportExternalSummary,
  type CommissionReportMode,
  type CommissionReportRow,
  type CommissionReportTechSummary,
  type CommissionReportTotals,
  type WorkizCommissionSnapshot,
} from '@bitcrm/types';
import type { CommissionDealItem, CommissionReportSortKey } from './commission-report.types';
import {
  calculateWorkizCommission,
  configInForce,
  resolveWorkizRate,
  round2,
  splitWorkizPayments,
  workizBalance,
  type LedgerPayment,
} from './workiz-commission.calc';

/**
 * The commissions report's pure half: which Done jobs fall in a period, one
 * row per job (Workiz's own numbers for an imported job, the Workiz formula
 * for a job done here), the filters, the Totals row, the per-technician and
 * per-company slices, the order and the CSV. No I/O — the service feeds it.
 */

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

/** The last day of the visit window — Workiz's "Closed". */
export function endDayOf(item: Pick<CommissionDealItem, 'scheduledEndDate' | 'scheduledDate'>): string | undefined {
  return item.scheduledEndDate || item.scheduledDate || undefined;
}

/** `HH:MM` the window ends: the snapshot's local end, else the slot's second half. */
export function closedTimeOf(item: CommissionDealItem): string | undefined {
  const local = item.commissionSnapshot?.closedLocal;
  if (local && local.length >= 16) return local.slice(11, 16);
  if (item.allDay || !item.scheduledTimeSlot) return undefined;
  const end = item.scheduledTimeSlot.split('-')[1];
  return end && /^\d{2}:\d{2}$/.test(end) ? end : undefined;
}

/** The calendar day an instant falls on in a zone (`YYYY-MM-DD`). */
export function localDay(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(
      new Date(iso),
    );
  } catch {
    return iso.slice(0, 10);
  }
}

/** The day a job counts on for the chosen "By Time" — Created is the local day in the job's zone. */
export function reportDayOf(item: CommissionDealItem, by: CommissionReportBy): string | undefined {
  if (by === 'closed') return endDayOf(item);
  if (by === 'scheduled') return item.scheduledDate || undefined;
  return item.createdAt ? localDay(item.createdAt, item.jobTimezone || DEFAULT_TIMEZONE) : undefined;
}

export function inPeriod(item: CommissionDealItem, by: CommissionReportBy, from: string, to: string): boolean {
  const day = reportDayOf(item, by);
  return Boolean(day) && day! >= from && day! <= to;
}

/** A job shared by several technicians is its primary's — the first one (Workiz). */
export function primaryTechOf(item: CommissionDealItem): string | undefined {
  return item.commissionSnapshot?.techId || item.assignedTechIds?.[0] || undefined;
}

/** Workiz's numbers are frozen on an imported job; a job done here is computed. */
export function needsCompute(item: CommissionDealItem): boolean {
  return !item.commissionSnapshot;
}

/** Workiz's Address cell: the street and the zip, " , " between ("215 Main St , 06851"). */
function addressLine(a: CommissionDealItem['address']): string {
  if (!a) return '';
  return [a.street?.trim(), a.zip?.trim()].filter(Boolean).join(' , ');
}

export interface RowContext {
  techNames: Map<string, string>;
  jobTypeNames: Map<string, string>;
  sourceNames: Map<string, string>;
  externalCompanyNames: Map<string, string>;
  /** The custom fields a job done here keeps its parts in ("Tech Parts cost", "Company Parts cost"). */
  partsFields: { tech?: string; company?: string };
  /** Ledgers of the jobs being computed. */
  payments: Map<string, LedgerPayment[]>;
  /** Commission version histories of their technicians. */
  configs: Map<string, CommissionConfig[]>;
}

function baseRow(item: CommissionDealItem, ctx: RowContext): Omit<
  CommissionReportRow,
  | 'total' | 'cash' | 'credit' | 'billing' | 'check' | 'rate' | 'rateUnit' | 'rateSource' | 'tip' | 'parts'
  | 'companyParts' | 'fees' | 'techProfit' | 'externalCompanyProfit' | 'companyProfit' | 'tax' | 'cashByExternal'
  | 'creditByExternal' | 'billingByExternal' | 'checkByExternal' | 'balance' | 'source'
> {
  const techId = primaryTechOf(item);
  const others = (item.assignedTechIds ?? []).filter((t) => t !== techId);
  return {
    dealId: item.id,
    dealNumber: String(item.dealNumber ?? ''),
    ...(item.invoiceId && { invoiceId: item.invoiceId }),
    ...(techId && { techId, techName: ctx.techNames.get(techId) }),
    techIds: techId ? [techId, ...others] : others,
    createdAt: item.createdAt ?? '',
    scheduledDate: item.scheduledDate,
    scheduledTimeSlot: item.allDay ? undefined : item.scheduledTimeSlot,
    closedDate: endDayOf(item),
    closedTime: closedTimeOf(item),
    jobTypeId: item.jobTypeId,
    jobTypeName: item.jobTypeId ? ctx.jobTypeNames.get(item.jobTypeId) : undefined,
    address: addressLine(item.address),
    serviceAreaId: item.serviceAreaId,
    serviceArea: item.serviceArea,
    contactId: item.contactId,
    externalCompanyId: item.externalCompanyId,
    externalCompanyName: item.externalCompanyId ? ctx.externalCompanyNames.get(item.externalCompanyId) : undefined,
    sourceId: item.sourceId,
    sourceName: item.sourceId ? ctx.sourceNames.get(item.sourceId) : undefined,
  };
}

/**
 * The technician's share of an imported row before Workiz rounded it. The
 * snapshot holds the rounded share only, but Workiz derives the balance from
 * the exact one, and on a negative balance a half cent rounds the other way
 * (48.625 − 100 → −51.38, 48.63 − 100 → −51.37). A half-cent share is
 * visible in the row itself: both shares round up, so they add up to one
 * cent more than what was split (8ZG2NQ: 946.99 + 946.99 of 1 893.97).
 */
export function snapshotShareExact(s: WorkizCommissionSnapshot): number {
  const split = num(s.total) - num(s.tax) - num(s.parts) - num(s.companyParts) - num(s.externalCompanyProfit);
  const excess = round2(num(s.techProfit) + num(s.companyProfit) - split);
  return excess === 0.01 ? num(s.techProfit) - 0.005 : num(s.techProfit);
}

/** One report row: Workiz's own when the import brought it, the Workiz formula otherwise. */
export function buildRow(item: CommissionDealItem, ctx: RowContext): CommissionReportRow {
  const base = baseRow(item, ctx);
  const snap = item.commissionSnapshot;
  if (snap) {
    const paid = snap.paid ?? { cash: 0, credit: 0, check: 0 };
    const row = {
      total: num(snap.total),
      cash: num(paid.cash),
      credit: num(paid.credit),
      billing: num(snap.billing),
      check: num(paid.check),
      tip: num(snap.tip),
      parts: num(snap.parts),
      companyParts: num(snap.companyParts),
      techProfit: num(snap.techProfit),
      externalCompanyProfit: num(snap.externalCompanyProfit),
      companyProfit: num(snap.companyProfit),
      tax: num(snap.tax),
      cashByExternal: num(snap.cashByExternal),
    };
    return {
      ...base,
      ...row,
      ...(snap.rate !== undefined && snap.rate !== null && { rate: num(snap.rate), rateUnit: snap.rateUnit === '$' ? '$' : '%' }),
      rateSource: snap.rate === undefined || snap.rate === null ? 'none' : snap.rateSource === 'special' ? 'special' : 'tech',
      creditByExternal: 0,
      billingByExternal: 0,
      checkByExternal: 0,
      balance: workizBalance({ ...row, techProfit: snapshotShareExact(snap) }),
      source: 'workiz',
    };
  }

  const techId = base.techId;
  const config = techId ? configInForce(ctx.configs.get(techId) ?? [], base.closedDate) : undefined;
  const rate = resolveWorkizRate(item, config);
  const split = splitWorkizPayments(ctx.payments.get(item.id) ?? []);
  const totals = item.totals ?? {};
  // A Workiz-shaped total already holds the tip; BitCRM's own (lines − discount + tax)
  // does not — the tip rides on the payment — so it is added, as Workiz's job total would.
  const workizTotals = typeof totals.tip === 'number';
  const tip = workizTotals ? num(totals.tip) : typeof item.tipAmount === 'number' ? item.tipAmount : split.tip;
  const baseTotal = totals.total !== undefined ? num(totals.total) : num(item.jobTotalPrice);
  const total = round2(workizTotals || typeof item.tipAmount === 'number' ? baseTotal : baseTotal + tip);
  const tax = totals.tax !== undefined ? num(totals.tax) : num(item.taxAmount);
  const custom = item.customFields ?? {};
  const parts = typeof item.parts === 'number' ? item.parts : num(ctx.partsFields.tech ? custom[ctx.partsFields.tech] : 0);
  const companyParts =
    typeof item.companyParts === 'number' ? item.companyParts : num(ctx.partsFields.company ? custom[ctx.partsFields.company] : 0);
  const result = calculateWorkizCommission({
    total,
    tax,
    tip,
    parts,
    companyParts,
    paid: split,
    fees: rate.fees,
    rate: rate.rate,
    rateUnit: rate.rateUnit,
  });
  const row = {
    total,
    cash: split.cash,
    credit: split.credit,
    billing: result.billing,
    check: split.check,
    tip,
    parts,
    companyParts,
    techProfit: result.techProfit,
    externalCompanyProfit: 0,
    companyProfit: result.companyProfit,
    tax,
    cashByExternal: split.cashByExternal,
  };
  return {
    ...base,
    ...row,
    rate: rate.rate,
    rateUnit: rate.rateUnit,
    rateSource: rate.rateSource,
    fees: result.fees,
    creditByExternal: 0,
    billingByExternal: 0,
    checkByExternal: 0,
    balance: workizBalance({ ...row, techProfit: result.techProfitExact }),
    source: 'computed',
  };
}

/* ---------------------------------------------------------------- filters */

export interface RowFilters {
  mode: CommissionReportMode;
  techId?: string;
  jobTypeId?: string;
  serviceAreaId?: string;
  /** A company id, or `only` for any company. */
  externalCompanyId?: string;
  sourceId?: string;
}

/**
 * The page's filters. `except` leaves one out — the technician list counts
 * each person's jobs under every OTHER filter, as Workiz's "[N]" does.
 */
export function matchesFilters(row: CommissionReportRow, f: RowFilters, except?: 'tech' | 'external'): boolean {
  if (except !== 'tech' && f.techId && row.techId !== f.techId) return false;
  if (f.jobTypeId && row.jobTypeId !== f.jobTypeId) return false;
  if (f.serviceAreaId && row.serviceAreaId !== f.serviceAreaId) return false;
  if (f.sourceId && row.sourceId !== f.sourceId) return false;
  if (except !== 'external' && f.externalCompanyId) {
    if (f.externalCompanyId === 'only' ? !row.externalCompanyId : row.externalCompanyId !== f.externalCompanyId) return false;
  }
  return true;
}

/** Workiz's search box: any of the text columns, case-insensitive. */
export function matchesSearch(row: CommissionReportRow, q: string | undefined): boolean {
  const needle = q?.trim().toLowerCase();
  if (!needle) return true;
  return [row.dealNumber, row.techName, row.jobTypeName, row.address, row.serviceArea, row.clientName, row.externalCompanyName, row.sourceName]
    .some((v) => typeof v === 'string' && v.toLowerCase().includes(needle));
}

/* ----------------------------------------------------------------- totals */

/**
 * Sum of every column and how many rows hold a POSITIVE amount in it —
 * Workiz's "(N Jobs)": over 2026-09-01..27 it counts 855 tech profits and
 * 1 023 company profits, where 856 and 1 032 rows are non-zero (one tech
 * profit and nine company profits are negative).
 */
export function totalsOf(rows: CommissionReportRow[]): CommissionReportTotals {
  const out = {} as CommissionReportTotals;
  for (const key of COMMISSION_REPORT_TOTAL_KEYS) {
    let amount = 0;
    let jobs = 0;
    for (const r of rows) {
      const v = r[key];
      amount += v;
      if (v > 0) jobs += 1;
    }
    out[key] = { amount: round2(amount), jobs };
  }
  return out;
}

export function techSummaries(rows: CommissionReportRow[]): CommissionReportTechSummary[] {
  const byTech = new Map<string, CommissionReportTechSummary>();
  for (const r of rows) {
    if (!r.techId) continue;
    const t = byTech.get(r.techId) ?? {
      techId: r.techId,
      techName: r.techName,
      jobs: 0,
      total: 0,
      techProfit: 0,
      parts: 0,
      companyParts: 0,
      tip: 0,
      tax: 0,
      balance: 0,
    };
    t.jobs += 1;
    t.total += r.total;
    t.techProfit += r.techProfit;
    t.parts += r.parts;
    t.companyParts += r.companyParts;
    t.tip += r.tip;
    t.tax += r.tax;
    t.balance += r.balance;
    byTech.set(r.techId, t);
  }
  return [...byTech.values()]
    .map((t) => ({
      ...t,
      total: round2(t.total),
      techProfit: round2(t.techProfit),
      parts: round2(t.parts),
      companyParts: round2(t.companyParts),
      tip: round2(t.tip),
      tax: round2(t.tax),
      balance: round2(t.balance),
    }))
    .sort((a, b) => (a.techName ?? a.techId).localeCompare(b.techName ?? b.techId));
}

export function externalSummaries(rows: CommissionReportRow[]): CommissionReportExternalSummary[] {
  const byCompany = new Map<string, CommissionReportExternalSummary>();
  for (const r of rows) {
    if (!r.externalCompanyId) continue;
    const c = byCompany.get(r.externalCompanyId) ?? {
      externalCompanyId: r.externalCompanyId,
      externalCompanyName: r.externalCompanyName,
      jobs: 0,
      total: 0,
      profit: 0,
    };
    c.jobs += 1;
    c.total += r.total;
    c.profit += r.externalCompanyProfit;
    byCompany.set(r.externalCompanyId, c);
  }
  return [...byCompany.values()]
    .map((c) => ({ ...c, total: round2(c.total), profit: round2(c.profit) }))
    .sort((a, b) => (a.externalCompanyName ?? a.externalCompanyId).localeCompare(b.externalCompanyName ?? b.externalCompanyId));
}

/* ------------------------------------------------------------------ money */

/**
 * A row for a caller without `financials.view`: every amount 0, no rate and
 * no fee — the job, its technician, client, dates and place stay.
 */
export function withoutMoney(row: CommissionReportRow): CommissionReportRow {
  const out = { ...row };
  for (const key of COMMISSION_REPORT_TOTAL_KEYS) out[key] = 0;
  delete out.rate;
  delete out.rateUnit;
  delete out.fees;
  return out;
}

/* ------------------------------------------------------------------ order */

function sortValue(row: CommissionReportRow, key: CommissionReportSortKey): string | number {
  switch (key) {
    case 'closedDate':
      return `${row.closedDate ?? ''}T${row.closedTime ?? ''}`;
    case 'scheduledDate':
      return `${row.scheduledDate ?? ''}T${row.scheduledTimeSlot ?? ''}`;
    case 'rate':
      return row.rate ?? -1;
    default: {
      const v = row[key];
      return typeof v === 'number' ? v : String(v ?? '').toLowerCase();
    }
  }
}

/** A stable order: the chosen column, then the closing moment, then the job number. */
export function sortRows(rows: CommissionReportRow[], key: CommissionReportSortKey, dir: 'asc' | 'desc'): CommissionReportRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  const cmp = (a: string | number, b: string | number): number =>
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b));
  return [...rows].sort(
    (a, b) =>
      sign * cmp(sortValue(a, key), sortValue(b, key)) ||
      cmp(sortValue(a, 'closedDate'), sortValue(b, 'closedDate')) ||
      a.dealNumber.localeCompare(b.dealNumber),
  );
}

/* -------------------------------------------------------------------- CSV */

type CsvColumn = { header: string; value: (r: CommissionReportRow) => string | number; total?: keyof CommissionReportTotals };

const money = (n: number): string => n.toFixed(2);
const rateLabel = (r: CommissionReportRow): string =>
  r.rate === undefined ? '' : r.rateUnit === '$' ? `${r.rate}$` : `${r.rate}%`;
const when = (day?: string, time?: string): string => [day, time].filter(Boolean).join(' ');

const COMMON_HEAD: CsvColumn[] = [
  { header: 'Job Id', value: (r) => r.dealNumber },
  { header: 'Tech', value: (r) => r.techName ?? '' },
];

/**
 * Columns per mode — the ones Workiz shows by default in each, plus client and
 * ad group. Without `money` only the job's own columns: no amount, no rate.
 */
export function csvColumns(mode: CommissionReportMode, withMoney = true): CsvColumn[] {
  const all = csvMoneyColumns(mode);
  return withMoney ? all : all.filter((c) => !c.total && !MONEY_HEADERS.has(c.header));
}

/** The amount columns that have no Totals key (a rate, a derived balance). */
const MONEY_HEADERS: ReadonlySet<string> = new Set(['Tech Share', 'Balance']);

function csvMoneyColumns(mode: CommissionReportMode): CsvColumn[] {
  const money$ = (header: string, key: keyof CommissionReportTotals): CsvColumn => ({
    header,
    value: (r) => money(r[key]),
    total: key,
  });
  const dates: CsvColumn[] =
    mode === 'tech'
      ? [
          { header: 'Created', value: (r) => r.createdAt.slice(0, 16).replace('T', ' ') },
          { header: 'Closed', value: (r) => when(r.closedDate, r.closedTime) },
        ]
      : [
          { header: 'Created', value: (r) => r.createdAt.slice(0, 16).replace('T', ' ') },
          { header: 'Scheduled', value: (r) => when(r.scheduledDate, r.scheduledTimeSlot?.slice(0, 5)) },
          { header: 'Closed', value: (r) => when(r.closedDate, r.closedTime) },
        ];
  const where: CsvColumn[] = [
    { header: 'Job Type', value: (r) => r.jobTypeName ?? '' },
    { header: 'Address', value: (r) => r.address },
  ];
  const paid: CsvColumn[] = [
    money$('Total', 'total'),
    money$('Cash', 'cash'),
    money$('Credit', 'credit'),
    money$('Billing', 'billing'),
    money$('Check', 'check'),
  ];
  const tail: CsvColumn[] = [
    { header: 'Client', value: (r) => r.clientName ?? '' },
    { header: 'Ad Group', value: (r) => r.sourceName ?? '' },
    { header: 'External Company', value: (r) => r.externalCompanyName ?? '' },
  ];
  if (mode === 'external') {
    return [
      ...COMMON_HEAD,
      ...dates,
      ...where,
      ...paid,
      money$('Parts', 'parts'),
      money$('Company Parts', 'companyParts'),
      money$('External Company Profit', 'externalCompanyProfit'),
      { header: 'Balance', value: (r) => money(-r.cashByExternal) },
      money$('Cash By External', 'cashByExternal'),
      money$('Tax', 'tax'),
      ...tail,
    ];
  }
  return [
    ...COMMON_HEAD,
    ...dates,
    ...where,
    ...paid,
    ...(mode === 'standard' ? [{ header: 'Tech Share', value: rateLabel }] : []),
    money$('Tip Amount', 'tip'),
    money$('Parts', 'parts'),
    money$('Company Parts', 'companyParts'),
    money$('Tech Profit', 'techProfit'),
    ...(mode === 'tech' ? [money$('Balance Tech', 'balance')] : [money$('Company Profit', 'companyProfit')]),
    money$('Tax', 'tax'),
    money$('Cash By External', 'cashByExternal'),
    ...tail,
  ];
}

const cell = (v: string | number): string => {
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The export: a header, a Totals line ("Totals:<N>", sums with their "(N Jobs)"), then every row. */
export function commissionReportCsv(
  rows: CommissionReportRow[],
  totals: CommissionReportTotals,
  mode: CommissionReportMode,
  withMoney = true,
): string {
  const cols = csvColumns(mode, withMoney);
  const totalLine = cols.map((c, i) => {
    if (i === 0) return `Totals:${rows.length}`;
    if (!c.total) return '';
    const t = totals[c.total];
    return `${money(t.amount)} (${t.jobs} Jobs)`;
  });
  return [
    cols.map((c) => cell(c.header)).join(','),
    totalLine.map(cell).join(','),
    ...rows.map((r) => cols.map((c) => cell(c.value(r))).join(',')),
  ].join('\r\n');
}
