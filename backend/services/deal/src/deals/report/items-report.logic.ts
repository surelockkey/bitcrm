import {
  ITEMS_REPORT_COLUMNS,
  JobSuperStatus,
  STAGE_TO_SUPER_STATUS,
  type DealStage,
  type ItemsReportFilters,
  type ItemsReportJobRow,
  type ItemsReportRow,
  type ItemsReportSort,
  type ItemsReportTotals,
} from '@bitcrm/types';
import { jobStartAt, type ReportDateSource } from './report-dates';
import { csvField } from './jobs-report.logic';

/**
 * The Items and services report's own logic — pure, so the endpoint, the
 * CSV and the offline check against Workiz's numbers
 * (`scripts/verify-items-report.ts`) run exactly the same arithmetic.
 *
 *   Done jobs of the window ─ toItemsDeal ─┐
 *   their PRODUCT# rows ─── toItemLine ────┴▶ WindowLine[] ─ filter ─▶ aggregate ─▶ search / sort / page | CSV
 *                                              price book (productFacts) ──┘
 */

/** The deal attributes the report reads off the window — nothing else crosses the wire or sits in the cache. */
export const ITEMS_DEAL_PROJECTION: readonly string[] = [
  'PK',
  'SK',
  'id',
  'status',
  'dealNumber',
  'jobSerial',
  'contactId',
  'clientName',
  'clientCompanyName',
  'jobTypeId',
  'createdAt',
  'scheduledDate',
  'scheduledEndDate',
  'scheduledTimeSlot',
  'allDay',
  'jobDateUtc',
  'jobEndDateUtc',
  'jobTimezone',
  'superStatus',
  'stage',
  'assignedTechIds',
  'isStub',
  'hasServicePlan',
];

/** The line attributes the report reads (`DEAL#<id>` / `PRODUCT#<lineId>`). */
export const ITEMS_LINE_PROJECTION: readonly string[] = [
  'SK',
  'lineId',
  'productId',
  'itemId',
  'name',
  'itemName',
  'type',
  'quantity',
  'priceClient',
  'costCompany',
  'soldBy',
  'addedBy',
  'fulfillment',
  'serial',
  'sku',
];

/**
 * Lines that are not items. Workiz keeps a job's card fee as a
 * `SERVICE_FEE_TYPE` line (item 10968 "service-fee") and a discount as a
 * `DISCOUNT_TYPE` line; its report counts neither (checked live: 536 fee
 * lines in the period, none in the report).
 */
const NOT_AN_ITEM = new Set(['service_fee_type', 'discount_type']);

/** Who wrote the imported lines — never a seller. */
const IMPORT_ACTOR = 'workiz-import';

/** The price-book stand-in for "no category". Workiz prints an empty cell. */
const UNCATEGORIZED = 'uncategorized';

/** A Done job as the report holds it. */
export interface ItemsDeal {
  id: string;
  jobNumber: string;
  jobSerial?: number;
  contactId: string;
  /** The per-job client name, when the job has one. */
  clientName?: string;
  clientCompany?: string;
  jobTypeId?: string;
  /** The job date — the visit's start on the account's clock. */
  jobDate?: string;
  superStatus: JobSuperStatus;
  techIds: string[];
  servicePlan: boolean;
  stub: boolean;
}

/** One line of a job, as the report counts it. */
export interface ItemLine {
  /** The row it adds to: the product id, else the Workiz item id, else the line's name. */
  key: string;
  productId?: string;
  /** Workiz item id carried on an imported line. */
  itemNumber?: number;
  name: string;
  /** Workiz's word for the type (`product`, `service`, `other`…), lowercased; '' when the line has none. */
  type: string;
  /** What the line's fulfillment says when neither it nor the price book names a type. */
  fallbackType: string;
  model?: string;
  quantity: number;
  price: number;
  cost: number;
  soldBy?: string;
}

/** What the price book says about an item — the current name, type, model and category, as Workiz joins them. */
export interface ProductFacts {
  id: string;
  number?: number;
  name: string;
  type: string;
  model?: string;
  category?: string;
}

/** A line with its job. The window is a list of these. */
export interface WindowLine {
  deal: ItemsDeal;
  line: ItemLine;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
const num = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
};
const intOf = (v: unknown): number | undefined => {
  const n = num(v);
  return n !== undefined && Number.isInteger(n) ? n : undefined;
};

/** Two decimals, halves away from zero, without the binary noise of `x * 100`. */
export function round2(x: number): number {
  const r = Math.round(Math.abs(x) * 100 + 1e-7) / 100;
  return x < 0 ? -r : r;
}

/** A window row (a deal METADATA item, projected) → the report's job. */
export function toItemsDeal(item: Record<string, unknown>): ItemsDeal {
  const clientName = item.clientName as { firstName?: string; lastName?: string } | undefined;
  const override = clientName ? `${clientName.firstName ?? ''} ${clientName.lastName ?? ''}`.trim() : '';
  return {
    id: String(item.id ?? ''),
    jobNumber: String(item.dealNumber ?? ''),
    jobSerial: intOf(item.jobSerial),
    contactId: String(item.contactId ?? ''),
    clientName: override || undefined,
    clientCompany: str(item.clientCompanyName),
    jobTypeId: str(item.jobTypeId),
    jobDate: jobStartAt(item as ReportDateSource),
    superStatus:
      (item.superStatus as JobSuperStatus | undefined) ??
      STAGE_TO_SUPER_STATUS[item.stage as DealStage] ??
      JobSuperStatus.SUBMITTED,
    techIds: Array.isArray(item.assignedTechIds) ? (item.assignedTechIds as string[]) : [],
    servicePlan: item.hasServicePlan === true,
    stub: item.isStub === true,
  };
}

/** A job the report counts: Done, not a Workiz estimate stub, its job date inside `from`..`to`. */
export function isCounted(d: ItemsDeal, from: string, to: string): boolean {
  if (d.stub || d.superStatus !== JobSuperStatus.DONE) return false;
  const day = d.jobDate?.slice(0, 10);
  return day !== undefined && day >= from && day <= to;
}

/**
 * A `PRODUCT#` row → the line the report counts, or null for a service fee
 * or discount line. Imported lines carry Workiz's own words (`type`,
 * `itemId`, `itemName`, `serial`, `soldBy`); a line added in BitCRM carries
 * only its product, so the price book fills those in (`productFacts`), and
 * the person who added it is who sold it.
 */
export function toItemLine(row: Record<string, unknown>): ItemLine | null {
  const type = (str(row.type) ?? '').trim().toLowerCase();
  if (NOT_AN_ITEM.has(type)) return null;
  const productId = str(row.productId);
  const itemNumber = intOf(row.itemId);
  const name = str(row.itemName)?.trim() || str(row.name)?.trim() || '';
  const fulfillment = str(row.fulfillment);
  const addedBy = str(row.addedBy);
  const sku = str(row.sku);
  return {
    key: productId ?? (itemNumber !== undefined ? `item:${itemNumber}` : `name:${name.toLowerCase()}`),
    productId,
    itemNumber,
    name,
    type,
    // No word on the line and no price book to ask: how it was fulfilled says enough.
    fallbackType: fulfillment === 'service' ? 'service' : fulfillment === 'sourced' || fulfillment === 'to_order' ? 'product' : '',
    model: str(row.serial)?.trim() || (sku && !/^WZ-\d+$/.test(sku) ? sku : undefined),
    quantity: num(row.quantity) ?? 0,
    price: num(row.priceClient) ?? 0,
    cost: num(row.costCompany) ?? 0,
    soldBy: str(row.soldBy) ?? (fulfillment !== 'imported' && addedBy && addedBy !== IMPORT_ACTOR ? addedBy : undefined),
  };
}

/**
 * A price-book item as the report prints it. `workizType` (other, hours)
 * wins over the stored `service`; the model is the Workiz serial, or a SKU
 * that is not the importer's `WZ-<id>` stand-in; "Uncategorized" is blank.
 */
export function productFacts(product: Record<string, unknown>): ProductFacts {
  const sku = str(product.sku);
  const imported = typeof product.externalId === 'string' && product.externalId.startsWith('workiz:');
  const category = str(product.category)?.trim();
  return {
    id: String(product.id ?? ''),
    number: intOf(product.number),
    name: str(product.name)?.trim() ?? '',
    type: (str(product.workizType) ?? str(product.type) ?? '').toLowerCase(),
    model: str(product.workizSerial)?.trim() || (sku && !(imported && /^WZ-\d+$/.test(sku)) ? sku : undefined),
    category: category && category.toLowerCase() !== UNCATEGORIZED ? category : undefined,
  };
}

/** The type a line is filtered on: its own word, else the price book's, else what its fulfillment implies. */
export function lineType(line: ItemLine, product?: ProductFacts): string {
  return line.type || product?.type || line.fallbackType;
}

const some = (list: string[] | undefined, pick: (v: string) => boolean): boolean =>
  !list || list.length === 0 || list.some(pick);

/** Workiz's MultiFilter over one line: every group narrows, a group matches any of its values. */
export function matchesItemFilters(entry: WindowLine, product: ProductFacts | undefined, f: ItemsReportFilters): boolean {
  const type = lineType(entry.line, product);
  const category = product?.category;
  return (
    some(f.type, (v) => v.toLowerCase() === type) &&
    some(f.jobTypeId, (v) => v === entry.deal.jobTypeId) &&
    some(f.category, (v) => category !== undefined && v.toLowerCase() === category.toLowerCase()) &&
    some(f.soldBy, (v) => v === entry.line.soldBy)
  );
}

/* ------------------------------------------------------------- aggregate */

interface Acc {
  key: string;
  first: ItemLine;
  units: number;
  price: number;
  cost: number;
  jobs: Set<string>;
  servicePlan: boolean;
}

function withMoney<T extends { price?: number; cost?: number; profit?: number; margin?: number }>(
  target: T,
  price: number,
  cost: number,
  money: boolean,
): T {
  if (!money) return target;
  const p = round2(price);
  const c = round2(cost);
  const profit = round2(p - c);
  target.price = p;
  target.cost = c;
  target.profit = profit;
  target.margin = p !== 0 ? round2((profit / p) * 100) : 0;
  return target;
}

/**
 * The window's lines grouped by item — Workiz's rows — and the Total row.
 * Totals sum the unrounded lines; a row prints its own sums rounded, and its
 * profit is exactly Price − Cost as printed.
 */
export function aggregate(
  entries: WindowLine[],
  products: Map<string, ProductFacts>,
  money: boolean,
): { rows: ItemsReportRow[]; totals: ItemsReportTotals } {
  const groups = new Map<string, Acc>();
  let units = 0;
  let price = 0;
  let cost = 0;
  for (const { deal, line } of entries) {
    let g = groups.get(line.key);
    if (!g) {
      g = { key: line.key, first: line, units: 0, price: 0, cost: 0, jobs: new Set(), servicePlan: false };
      groups.set(line.key, g);
    }
    const p = line.quantity * line.price;
    const c = line.quantity * line.cost;
    g.units += line.quantity;
    g.price += p;
    g.cost += c;
    g.jobs.add(deal.id);
    if (deal.servicePlan) g.servicePlan = true;
    units += line.quantity;
    price += p;
    cost += c;
  }
  const rows = [...groups.values()].map((g) => {
    const product = g.first.productId ? products.get(g.first.productId) : undefined;
    const row: ItemsReportRow = {
      key: g.key,
      ...(g.first.productId && { productId: g.first.productId }),
      ...((product?.number ?? g.first.itemNumber) !== undefined && { number: product?.number ?? g.first.itemNumber }),
      name: product?.name || g.first.name,
      type: product?.type || g.first.type || g.first.fallbackType,
      ...((product ? product.model : g.first.model) && { model: product ? product.model : g.first.model }),
      ...(product?.category && { category: product.category }),
      units: round2(g.units),
      jobs: g.jobs.size,
      servicePlan: g.servicePlan,
    };
    return withMoney(row, g.price, g.cost, money);
  });
  const totals = withMoney<ItemsReportTotals>({ items: rows.length, units: round2(units) }, price, cost, money);
  return { rows, totals };
}

/** Workiz's Search box: the item's name, its model #, its number. */
export function matchesItemSearch(row: ItemsReportRow, q: string): boolean {
  const needle = q.trim().toLowerCase().replace(/^#/, '');
  if (!needle) return true;
  return (
    row.name.toLowerCase().includes(needle) ||
    (row.model ?? '').toLowerCase().includes(needle) ||
    (row.number !== undefined && String(row.number).startsWith(needle))
  );
}

function sortValue(row: ItemsReportRow, column: ItemsReportSort): string | number | undefined {
  switch (column) {
    case 'number': return row.number;
    case 'item': return row.name.toLowerCase();
    case 'model': return row.model?.toLowerCase();
    case 'category': return row.category?.toLowerCase();
    case 'units': return row.units;
    case 'price': return row.price;
    case 'cost': return row.cost;
    case 'profit': return row.profit;
    case 'jobs': return row.jobs;
    default: return undefined;
  }
}

/** Sorted on one column; an empty value sorts last either way, ties by the row key so pages never shuffle. */
export function sortItemRows(rows: ItemsReportRow[], column: ItemsReportSort, dir: 'asc' | 'desc'): ItemsReportRow[] {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = sortValue(a, column);
    const vb = sortValue(b, column);
    if (va === undefined || va === '') return vb === undefined || vb === '' ? a.key.localeCompare(b.key) : 1;
    if (vb === undefined || vb === '') return -1;
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return c !== 0 ? c * sign : a.key.localeCompare(b.key);
  });
}

/* ------------------------------------------------------------ drill-down */

/** A drill-down row before its names: the client when the job carries its own, the sellers as ids. */
export type ItemJobDraft = Omit<ItemsReportJobRow, 'client' | 'soldBy'> & { client?: string; soldByIds: string[] };

/**
 * The jobs of one item — Workiz's expanded row: one row per job, its lines
 * of the item merged (Labor on 192 lines is 192 jobs), newest job date first.
 * The sellers come back as ids; the caller names them.
 */
export function jobsOfItem(
  entries: WindowLine[],
  key: string,
  money: boolean,
): ItemJobDraft[] {
  const byDeal = new Map<string, { deal: ItemsDeal; units: number; price: number; cost: number; soldBy: Set<string> }>();
  for (const { deal, line } of entries) {
    if (line.key !== key) continue;
    let g = byDeal.get(deal.id);
    if (!g) {
      g = { deal, units: 0, price: 0, cost: 0, soldBy: new Set() };
      byDeal.set(deal.id, g);
    }
    g.units += line.quantity;
    g.price += line.quantity * line.price;
    g.cost += line.quantity * line.cost;
    if (line.soldBy) g.soldBy.add(line.soldBy);
  }
  return [...byDeal.values()]
    .sort(
      (a, b) =>
        (b.deal.jobDate ?? '').localeCompare(a.deal.jobDate ?? '') ||
        (b.deal.jobSerial ?? 0) - (a.deal.jobSerial ?? 0) ||
        a.deal.id.localeCompare(b.deal.id),
    )
    .map((g) =>
      withMoney<ItemJobDraft>(
        {
          dealId: g.deal.id,
          jobNumber: g.deal.jobNumber,
          ...(g.deal.jobSerial !== undefined && { jobSerial: g.deal.jobSerial }),
          ...(g.deal.jobDate && { jobDate: g.deal.jobDate }),
          contactId: g.deal.contactId,
          ...(g.deal.clientName && { client: g.deal.clientName }),
          ...(g.deal.clientCompany && { clientCompany: g.deal.clientCompany }),
          units: round2(g.units),
          servicePlan: g.deal.servicePlan,
          soldByIds: [...g.soldBy],
        },
        g.price,
        g.cost,
        money,
      ),
    );
}

/* -------------------------------------------------------------------- CSV */

const fixed2 = (n: number | undefined): string => (n === undefined ? '' : n.toFixed(2));

/**
 * Workiz's export: `Item, SKU, Units, Category, Price, Cost, Profit, Jobs,
 * Service Plan`, the first line `Totals`. Money columns are left out for a
 * caller who may not see money.
 */
export function itemsCsv(rows: ItemsReportRow[], totals: ItemsReportTotals, money: boolean): string {
  const columns = ITEMS_REPORT_COLUMNS.filter((c) => money || !c.money);
  const header = [...columns.map((c) => c.csv), 'Service Plan'];
  const cells = (r: {
    item: string;
    model?: string;
    units: number;
    category?: string;
    price?: number;
    cost?: number;
    profit?: number;
    jobs: string;
    servicePlan: string;
  }): string[] => [
    ...columns.map((c) => {
      switch (c.id) {
        case 'item': return csvField(r.item);
        case 'model': return csvField(r.model ?? '');
        case 'units': return csvField(fixed2(r.units), true);
        case 'category': return csvField(r.category ?? '');
        case 'price': return csvField(fixed2(r.price), true);
        case 'cost': return csvField(fixed2(r.cost), true);
        case 'profit': return csvField(fixed2(r.profit), true);
        case 'jobs': return csvField(r.jobs, true);
        default: return '';
      }
    }),
    csvField(r.servicePlan),
  ];
  const lines = [
    header.map((h) => csvField(h)).join(','),
    cells({ item: 'Totals', units: totals.units, price: totals.price, cost: totals.cost, profit: totals.profit, jobs: '', servicePlan: '' }).join(','),
    ...rows.map((r) =>
      cells({
        item: r.name,
        model: r.model,
        units: r.units,
        category: r.category,
        price: r.price,
        cost: r.cost,
        profit: r.profit,
        jobs: String(r.jobs),
        servicePlan: r.servicePlan ? 'Yes' : 'No',
      }).join(','),
    ),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
