import { createReadStream, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import type { Estimate, Invoice, Payment, PaymentRefund } from '@bitcrm/types';
import { METADATA_SK, REFUND_SK_PREFIX, stripKeys } from '../common/constants/dynamo.constants';
import { estimateCards } from '../estimates/report/estimate-report.rules';
import { agingCards, dayWindow, inWindow, invoiceCards, isOpen } from '../invoices/report/invoice-report.rules';
import { reportLines } from '../payments/report/payment-report.rules';
import { paidByJob } from '../reports/paid-by-job.rules';

/**
 * Offline check of the billing reports against a Workiz import package — the
 * SAME rules the endpoints run, over the package's `billing/part-*.jsonl`,
 * no AWS at all. Prints what Aging invoices, the Invoices report (list totals
 * and cards) and the Estimates cards would show, and writes the per-job
 * collections the Tax report's Paid tab asks billing for.
 *
 *   npx ts-node src/scripts/verify-billing-reports.ts --jsonl <package>/billing \
 *     --from 2026-09-01 --to 2026-09-27 --today 2026-09-29 [--paid-out paid.json]
 */

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function readPackage(dir: string) {
  const invoices: Invoice[] = [];
  const estimates: Estimate[] = [];
  const payments: Payment[] = [];
  const refunds = new Map<string, PaymentRefund[]>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort()) {
    const rl = createInterface({ input: createReadStream(join(dir, file)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line) continue;
      const item = JSON.parse(line) as Record<string, unknown>;
      const pk = String(item.PK);
      const sk = String(item.SK);
      if (pk.startsWith('INVOICE#') && sk === METADATA_SK) invoices.push(stripKeys<Invoice>(item)!);
      else if (pk.startsWith('ESTIMATE#') && sk === METADATA_SK) estimates.push(stripKeys<Estimate>(item)!);
      else if (pk.startsWith('PAYMENT#') && sk === METADATA_SK) payments.push(stripKeys<Payment>(item)!);
      else if (pk.startsWith('PAYMENT#') && sk.startsWith(REFUND_SK_PREFIX)) {
        const r = stripKeys<PaymentRefund>(item)!;
        refunds.set(r.paymentId, [...(refunds.get(r.paymentId) ?? []), r]);
      }
    }
  }
  return { invoices, estimates, payments, refunds };
}

const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + Math.round(x * 100), 0)) / 100;

async function main(): Promise<void> {
  const dir = arg('--jsonl');
  const from = arg('--from');
  const to = arg('--to');
  const today = arg('--today');
  if (!dir || !from || !to || !today) {
    console.error('usage: --jsonl <billing dir> --from YYYY-MM-DD --to YYYY-MM-DD --today YYYY-MM-DD [--paid-out file]');
    process.exit(2);
  }
  const { invoices, estimates, payments, refunds } = await readPackage(dir);
  console.log(`package: ${invoices.length} invoices, ${estimates.length} estimates, ${payments.length} payments`);

  // ---- Aging invoices (as of --today): the rows UnpaidIndex would hold.
  const open = invoices.filter(isOpen);
  const aging = agingCards(open, today);
  console.log(`\nAging invoices as of ${today}`);
  for (const [k, c] of Object.entries(aging)) console.log(`  ${k.padEnd(11)} ${String(c.count).padStart(5)}  $${money(c.amount)}`);
  const notYet = open.filter((i) => !(i.dueDate < today));
  console.log(`  not yet due ${String(notYet.length).padStart(5)}  $${money(sum(notYet.map((i) => i.totals.balanceDue)))}`);
  const cent = open.filter((i) => i.totals.balanceDue <= 0.01);
  console.log(`  (of them owing ≤ $0.01: ${cent.length}, $${money(sum(cent.map((i) => i.totals.balanceDue)))})`);

  // ---- Invoices report: the list for the created window, and its cards.
  const w = dayWindow(from, to);
  const listed = invoices.filter((i) => inWindow(i.createdAt, w));
  console.log(`\nInvoices created ${from}..${to}`);
  console.log(`  count ${listed.length}`);
  console.log(`  Σ subtotal $${money(sum(listed.map((i) => i.totals.subtotal)))}`);
  console.log(`  Σ tax      $${money(sum(listed.map((i) => i.totals.tax)))}`);
  console.log(`  Σ amount   $${money(sum(listed.map((i) => i.totals.total)))}`);
  console.log(`  Σ due      $${money(sum(listed.map((i) => i.totals.balanceDue)))}`);
  const cards = invoiceCards(open, w, today);
  console.log(`  cards: due ${cards.due.count} / $${money(cards.due.amount)}, overdue ${cards.overdue.count} / $${money(cards.overdue.amount)}, unsent ${cards.unsent.count}`);
  const allCards = invoiceCards(open, {}, today);
  console.log(`  cards All time: due ${allCards.due.count} / $${money(allCards.due.amount)}, overdue ${allCards.overdue.count} / $${money(allCards.overdue.amount)}, unsent ${allCards.unsent.count}`);

  // ---- Estimates cards for the created window.
  const est = estimateCards(estimates.filter((e) => inWindow(e.createdAt, w)));
  console.log(`\nEstimates created ${from}..${to}`);
  for (const [k, c] of Object.entries(est)) console.log(`  ${k.padEnd(9)} ${String(c.count).padStart(4)}  $${money(c.amount)}`);

  // ---- Paid by job (what billing hands the Tax report's Paid tab).
  const lines = payments.flatMap((p) => reportLines(p, refunds.get(p.id) ?? []));
  const inWin = lines.filter((l) => l.day >= from && l.day <= to);
  const paid = paidByJob(inWin);
  console.log(`\nPaid by job ${from}..${to}: ${paid.length} jobs, ${inWin.length} lines`);
  const out = arg('--paid-out');
  if (out) {
    writeFileSync(out, JSON.stringify(paid));
    console.log(`  written to ${out}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
