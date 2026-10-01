import { createReadStream, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import type { TaxReportRow } from '@bitcrm/types';
import { reportDay, type ReportDateSource } from '../deals/report/report-dates';
import {
  TAX_REPORT_PROJECTION,
  accrualRows,
  dealTaxFigures,
  paidRows,
  sortTaxRows,
  sumAmount,
  type TaxDealRow,
} from '../deals/report/tax-report.rules';

/**
 * Offline check of the Tax report against a Workiz import package — the SAME
 * rules the endpoint runs (`dealTaxFigures`, `reportDay`, `accrualRows`,
 * `paidRows`), over the package's `deals/part-*.jsonl`, no AWS. The Paid tab
 * takes billing's per-job collections from `verify-billing-reports.ts
 * --paid-out`.
 *
 *   npx ts-node src/scripts/verify-tax-report.ts --jsonl <package>/deals \
 *     --from 2026-09-01 --to 2026-09-27 [--paid paid.json]
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const KEEP = new Set<string>(TAX_REPORT_PROJECTION);

async function readDeals(dir: string): Promise<Array<TaxDealRow & ReportDateSource>> {
  const out: Array<TaxDealRow & ReportDateSource> = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    const rl = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity });
    for await (const line of rl) {
      // Only job rows: `{"PK":"DEAL#…","SK":"METADATA",…}`.
      if (!line.startsWith('{"PK":"DEAL#') || !line.slice(0, 120).includes('"SK":"METADATA"')) continue;
      const item = JSON.parse(line) as Record<string, unknown>;
      if (item.status === 'deleted') continue;
      const row: Record<string, unknown> = {};
      for (const k of KEEP) if (item[k] !== undefined) row[k] = item[k];
      out.push(row as unknown as TaxDealRow & ReportDateSource);
    }
  }
  return out;
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function print(title: string, rows: TaxReportRow[]): void {
  console.log(`\n${title} — total $${money(sumAmount(rows))}`);
  for (const r of rows) {
    const nt = r.nonTaxableAmount === undefined ? '' : `  non-taxable ${money(r.nonTaxableAmount)}`;
    console.log(`  ${r.name.padEnd(14)} ${r.rate.toFixed(2).padStart(6)}%  amount ${money(r.amount).padStart(10)}  taxable ${money(r.taxableAmount).padStart(11)}${nt}  jobs ${r.jobs}`);
  }
}

async function main(): Promise<void> {
  const dir = arg('--jsonl');
  const from = arg('--from');
  const to = arg('--to');
  if (!dir || !from || !to) {
    console.error('usage: --jsonl <deals dir> --from YYYY-MM-DD --to YYYY-MM-DD [--paid paid.json]');
    process.exit(2);
  }
  const deals = await readDeals(dir);
  console.log(`package: ${deals.length} jobs`);

  for (const by of ['end', 'scheduled', 'created'] as const) {
    const jobs = deals
      .filter((d) => {
        const day = reportDay(d, by);
        return !!day && day >= from && day <= to;
      })
      .map(dealTaxFigures)
      .filter((f): f is NonNullable<typeof f> => f !== null);
    print(`Accrual, by ${by}, ${from}..${to}`, sortTaxRows(accrualRows(jobs), 'accrual'));
  }

  const paidFile = arg('--paid');
  if (paidFile) {
    const paid = new Map((JSON.parse(readFileSync(paidFile, 'utf8')) as Array<{ dealId: string; paid: number }>).map((p) => [p.dealId, p.paid]));
    const jobs = deals
      .filter((d) => (paid.get(d.id) ?? 0) > 0)
      .map((d) => ({ figures: dealTaxFigures(d), collected: paid.get(d.id)! }))
      .filter((j): j is { figures: NonNullable<typeof j.figures>; collected: number } => j.figures !== null);
    print(`Paid, ${from}..${to}`, sortTaxRows(paidRows(jobs), 'paid'));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
