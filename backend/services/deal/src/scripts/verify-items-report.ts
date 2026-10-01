/**
 * Check the Items and services report against Workiz — offline, read-only.
 *
 * WHY
 * ---
 * The report must give the numbers Workiz gives for the same period. Workiz
 * was read live on 2026-09-29 (~19:15 UTC) for 2026-09-01..27
 * (`workiz-data-parser/docs/reports/items-and-services.md`, «Перевірено
 * наживо»): 271 items, Units 6 266.15, Price $631 162.95, Cost $61 474.18,
 * Profit $569 688.77 (90.26 %); type=product 234 items / $189 715.47,
 * type=service 36 / $440 639.96.
 *
 * This runs the report's own code (`items-report.logic.ts`: Done jobs on the
 * job date, the service fee and discount lines out, grouping, the filters,
 * the money) over a Workiz import package — the very rows the importer
 * writes to DynamoDB: the deals table (`DEAL#…/METADATA` + `PRODUCT#…`) and
 * the inventory table (`PRODUCT#…/METADATA`, the price book) — and prints
 * the same figures beside Workiz's.
 *
 * `--service` runs the period once more through the endpoint's own path —
 * `ItemsReportService.page()` over a real `DealsRepository` whose DynamoDB
 * is the report indexes in memory (`jobs-report-in-memory.ts`), the lines
 * and the price book from the package — and says whether it gives the same
 * totals.
 *
 * `--explain` looks for Done jobs outside the window whose item lines are
 * exactly the difference from Workiz (a job Workiz counted on another date).
 *
 * Nothing is written anywhere; the package is only read.
 *
 * USAGE
 * -----
 *   npm run verify:items-report -w backend/services/deal -- \
 *     --package <dir with deals/ and inventory/> [--from 2026-09-01 --to 2026-09-27] [--service] [--explain]
 */
import { createReadStream, readdirSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { JobSuperStatus, type ItemsReportFilters, type ItemsReportTotals, type ResolvedPermissions } from '@bitcrm/types';
import { DealsRepository } from '../deals/deals.repository';
import {
  ITEMS_DEAL_PROJECTION,
  aggregate,
  isCounted,
  matchesItemFilters,
  productFacts,
  round2,
  toItemLine,
  toItemsDeal,
  type ItemsDeal,
  type ProductFacts,
  type WindowLine,
} from '../deals/report/items-report.logic';
import { ItemsReportService } from '../deals/report/items-report.service';
import type { ItemsReportQueryDto } from '../deals/report/items-report.query';
import { shiftDay } from '../deals/report/report-dates';
import { InMemoryReportIndexes } from './jobs-report-in-memory';

/** Workiz, live, 2026-09-29 ≈19:15 UTC, `date_query = "1.9.26_27.9.26"`. */
const WORKIZ = {
  all: { items: 271, units: 6266.15, price: 631162.95, cost: 61474.18, profit: 569688.77, margin: 90.26 },
  product: { items: 234, units: 1079, price: 189715.47, cost: 56878.53 },
  service: { items: 36, units: 5173.15, price: 440639.96, cost: 4595.65 },
  top: [
    { number: 10897, name: 'Service Call', units: 983.5, price: 111704.76, jobs: 555 },
    { number: 10455, name: 'Lock Install', units: 1382, price: 99399.96, jobs: 23 },
    { number: 9588, name: 'Labor', units: 637.35, price: 67782.36, jobs: 192 },
  ],
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function* rowsOf(dir: string, test: (line: string) => boolean): AsyncGenerator<Record<string, unknown>> {
  const parts = readdirSync(dir).filter((f) => /^part-.*\.jsonl$/.test(f)).sort();
  if (!parts.length) throw new Error(`No part-*.jsonl in ${dir}`);
  for (const part of parts) {
    const lines = createInterface({ input: createReadStream(join(dir, part)), crlfDelay: Infinity });
    for await (const line of lines) if (test(line)) yield JSON.parse(line) as Record<string, unknown>;
  }
}

const isDealRow = (line: string) => line.startsWith('{"PK":"DEAL#') || line.startsWith('{"PK": "DEAL#');

interface Package {
  /** Deal rows near the window, projected — what the in-memory indexes hold. */
  near: Record<string, unknown>[];
  /** Done jobs within the explain margin, by id. */
  done: Map<string, ItemsDeal>;
  /** Their lines, raw. */
  lines: Map<string, Record<string, unknown>[]>;
  products: Map<string, Record<string, unknown>>;
}

async function readPackage(dir: string, from: string, to: string, margin: number): Promise<Package> {
  const lo = shiftDay(from, -margin);
  const hi = shiftDay(to, margin);
  const near: Record<string, unknown>[] = [];
  const done = new Map<string, ItemsDeal>();
  for await (const item of rowsOf(join(dir, 'deals'), (l) => isDealRow(l) && l.slice(0, 160).includes('"SK":"METADATA"'))) {
    if (item.SK !== 'METADATA' || item.status !== 'active') continue;
    const touches = ['createdAt', 'scheduledDate', 'scheduledEndDate', 'jobDateUtc'].some((k) => {
      const v = typeof item[k] === 'string' ? (item[k] as string).slice(0, 10) : '';
      return v >= lo && v <= hi;
    });
    if (!touches) continue;
    near.push(Object.fromEntries(ITEMS_DEAL_PROJECTION.filter((k) => item[k] !== undefined).map((k) => [k, item[k]])));
    const d = toItemsDeal(item);
    if (d.superStatus === JobSuperStatus.DONE && !d.stub) done.set(d.id, d);
  }
  const lines = new Map<string, Record<string, unknown>[]>();
  for await (const row of rowsOf(join(dir, 'deals'), (l) => isDealRow(l) && l.includes('"SK":"PRODUCT#'))) {
    const id = String(row.PK).slice('DEAL#'.length);
    if (!done.has(id) || !String(row.SK).startsWith('PRODUCT#')) continue;
    const list = lines.get(id) ?? [];
    list.push(row);
    lines.set(id, list);
  }
  const products = new Map<string, Record<string, unknown>>();
  for await (const row of rowsOf(join(dir, 'inventory'), (l) => l.startsWith('{"PK":"PRODUCT#') || l.startsWith('{"PK": "PRODUCT#'))) {
    if (row.SK === 'METADATA') products.set(String(row.id), row);
  }
  return { near, done, lines, products };
}

const money = (n: number | undefined) =>
  n === undefined ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const units = (n: number | undefined) =>
  n === undefined ? '' : n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

function table(header: string[], rows: string[][]): void {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join(' | ');
  console.log(line(header));
  console.log(widths.map((w) => '-'.repeat(w)).join('-|-'));
  for (const r of rows) console.log(line(r));
  console.log('');
}

function compare(label: string, workiz: Partial<ItemsReportTotals> & { items: number }, ours: ItemsReportTotals): string[][] {
  const out: string[][] = [];
  for (const k of ['items', 'units', 'price', 'cost', 'profit', 'margin'] as const) {
    const w = workiz[k];
    const o = ours[k];
    if (w === undefined || o === undefined) continue;
    const d = round2(w - o);
    const fmt = k === 'items' ? String : k === 'units' ? units : k === 'margin' ? (n: number) => `${n.toFixed(2)} %` : money;
    out.push([`${label} ${k}`, fmt(w), fmt(o), d === 0 ? '0' : fmt(d), w ? `${((d / w) * 100).toFixed(3)} %` : '']);
  }
  return out;
}

async function throughTheService(pkg: Package, from: string, to: string, expected: ItemsReportTotals): Promise<void> {
  const indexes = new InMemoryReportIndexes(pkg.near);
  const repository = new DealsRepository(indexes.dynamoDb as never);
  const lines = { linesOf: async (ids: string[]) => new Map(ids.filter((id) => pkg.lines.has(id)).map((id) => [id, pkg.lines.get(id)!])) };
  const http = {
    getProductsForReport: async (ids: string[]) => new Map(ids.filter((id) => pkg.products.has(id)).map((id) => [id, pkg.products.get(id)!])),
    getUserNamesBatch: async () => [],
    getContactNames: async () => [],
  };
  const service = new ItemsReportService(repository, lines as never, http as never);
  const perms = { roleId: 'x', roleName: 'Super Admin', isSystemRole: true, permissions: {}, dataScope: {} } as unknown as ResolvedPermissions;
  const caller = { user: { id: 'verify', cognitoSub: '', email: '', roleId: 'x', department: '' }, perms };
  let rows = 0;
  let totals: ItemsReportTotals | undefined;
  for (let page = 1; ; page++) {
    const res = await service.page({ from, to, page: String(page), pageSize: '100' } as ItemsReportQueryDto, caller);
    rows += res.rows.length;
    totals = res.totals;
    if (page >= res.pagination.pages) break;
  }
  const same = JSON.stringify(totals) === JSON.stringify(expected) && rows === expected.items;
  console.log(
    `Through the endpoint (ItemsReportService.page → readReportWindow Done-only → indexes in memory, ${indexes.queries} index queries): ` +
      `${rows} rows paged, ${same ? 'the same totals as the report logic' : `DIFFERENT totals ${JSON.stringify(totals)}`}\n`,
  );
}

async function main(): Promise<void> {
  const dir = arg('package');
  if (!dir) throw new Error('--package <dir> is required');
  const from = arg('from') ?? '2026-09-01';
  const to = arg('to') ?? '2026-09-27';
  const explain = process.argv.includes('--explain');

  const pkg = await readPackage(dir, from, to, explain ? 60 : 2);
  const products = new Map<string, ProductFacts>([...pkg.products].map(([id, p]) => [id, productFacts(p)]));
  const entries: WindowLine[] = [];
  const counted = [...pkg.done.values()].filter((d) => isCounted(d, from, to));
  for (const deal of counted) {
    for (const row of pkg.lines.get(deal.id) ?? []) {
      const line = toItemLine(row);
      if (line) entries.push({ deal, line });
    }
  }
  const over = (f: ItemsReportFilters) =>
    aggregate(
      entries.filter((e) => matchesItemFilters(e, e.line.productId ? products.get(e.line.productId) : undefined, f)),
      products,
      true,
    );
  const all = over({});
  const product = over({ type: ['product'] });
  const service = over({ type: ['service'] });

  console.log(`Package: ${dir}\nPeriod: ${from}..${to} (job date, America/New_York, inclusive)`);
  console.log(
    `  ${counted.length} Done jobs, ${counted.filter((d) => pkg.lines.has(d.id)).length} with lines, ${entries.length} item lines ` +
      `(service fee / discount lines left out), ${pkg.products.size} price-book items\n`,
  );

  const header = ['Metric', 'Workiz', 'BitCRM', 'Workiz − BitCRM', 'Δ %'];
  table(header, [
    ...compare('all', WORKIZ.all, all.totals),
    ...compare('product', WORKIZ.product, product.totals),
    ...compare('service', WORKIZ.service, service.totals),
  ]);

  const others = over({ type: ['hours', 'expense', 'equipment', 'warranty'] }).totals.items;
  const untyped = all.rows.filter((r) => r.type !== 'product' && r.type !== 'service');
  console.log(
    `hours / expense / equipment / warranty: ${others} items (Workiz 0); items of another type: ` +
      `${untyped.map((r) => `#${r.number ?? '?'} ${r.name} (${r.type})`).join(', ') || 'none'}\n`,
  );

  const byNumber = new Map(all.rows.map((r) => [r.number, r]));
  table(
    ['Top item', 'Workiz units', 'BitCRM units', 'Workiz price', 'BitCRM price', 'Workiz jobs', 'BitCRM jobs'],
    WORKIZ.top.map((w) => {
      const o = byNumber.get(w.number);
      return [`#${w.number} ${w.name}`, units(w.units), units(o?.units), money(w.price), money(o?.price), String(w.jobs), String(o?.jobs ?? '')];
    }),
  );

  if (explain) {
    const d = { units: round2(WORKIZ.all.units - all.totals.units), price: round2(WORKIZ.all.price - all.totals.price!), cost: round2(WORKIZ.all.cost - all.totals.cost!) };
    console.log(`Looking for a Done job outside the period whose item lines are exactly ${JSON.stringify(d)}:`);
    let found = 0;
    for (const deal of pkg.done.values()) {
      if (isCounted(deal, from, to)) continue;
      const mine = (pkg.lines.get(deal.id) ?? []).map(toItemLine).filter((l): l is NonNullable<typeof l> => l !== null);
      const t = aggregate(mine.map((line) => ({ deal, line })), products, true).totals;
      if (round2(t.units) === d.units && t.price === d.price && t.cost === d.cost) {
        found += 1;
        const known = mine.every((l) => all.rows.some((r) => r.key === l.key));
        console.log(
          `  job ${deal.jobNumber} (#${deal.jobSerial ?? '?'}, deal ${deal.id}), job date ${deal.jobDate}: ` +
            `${mine.map((l) => `#${l.itemNumber ?? '?'} ${l.quantity}×${l.price}`).join(', ')}` +
            `${known ? ' — every item already has a row, so the item count stays the same' : ''}`,
        );
      }
    }
    if (!found) console.log('  none');
    console.log('');
  }

  if (process.argv.includes('--service')) await throughTheService(pkg, from, to, all.totals);
}

main().catch((err) => {
  console.error('verify-items-report failed:', err);
  process.exit(1);
});
