import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { createReadStream, readdirSync } from 'fs';
import { createInterface } from 'readline';
import { BatchWriteCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDbService } from '@bitcrm/shared';
import { paymentReportTypeLabel, type Deal, type Payment, type PaymentRefund } from '@bitcrm/types';
import {
  BILLING_TABLE,
  METADATA_SK,
  PAYMENT_REPORT_POINTER_SK,
  PAYREPORT_INDEX_PK,
  PAYREPORT_INDEX_SK,
  REFUND_SK_PREFIX,
  paymentPk,
  stripKeys,
} from '../common/constants/dynamo.constants';
import { DEAL_SERVICE_URL, INTERNAL_SERVICE_SECRET } from '../common/constants/services.constants';
import { buildProjection, bucketRowsFor, type BuiltProjection } from '../payments/report/payment-report.build';
import {
  PAYMENT_REPORT_TZ,
  aggregatePlan,
  businessDay,
  expandTypes,
  isDay,
  totalsFrom,
  type LineDims,
} from '../payments/report/payment-report.rules';

/**
 * Rebuilds the Payments report projection (`PAYLINE#` lines, `PAYAGG#`
 * buckets, `PAYMENT#<id>/REPORT` pointers, `PAYREPORT/INDEX`) from the
 * ledger. A derived projection RECONCILES: rows the ledger no longer
 * explains are deleted, the rest are overwritten with absolute values.
 * Idempotent — run it again and nothing changes.
 *
 *   npm run rebuild:payment-report -w billing-service                     # write
 *   npm run rebuild:payment-report -w billing-service -- --dry-run        # compute + compare, write nothing
 *   npm run rebuild:payment-report -w billing-service -- --no-deals       # skip deal-service (no area / job #)
 *   npm run rebuild:payment-report -w billing-service -- --jsonl <dir>    # offline: a Workiz import package's
 *                                                                          # billing/ folder, no AWS at all
 *   … --from 2026-09-01 --to 2026-09-27 [--types charge,cash]            # the totals table to print
 *
 * Run it after the deploy that ships the report, and again after every
 * Workiz import. Live payment writes keep the projection current on their
 * own; a write that lands DURING a rebuild can be overwritten by it, so run
 * it in a quiet window (or run it twice).
 */

interface Args {
  dryRun: boolean;
  noDeals: boolean;
  jsonl?: string;
  from?: string;
  to?: string;
  types: string[];
  segments: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    dryRun: argv.includes('--dry-run'),
    noDeals: argv.includes('--no-deals'),
    jsonl: get('--jsonl'),
    from: get('--from'),
    to: get('--to'),
    types: (get('--types') ?? '').split(',').filter(Boolean),
    segments: Number(get('--segments')) || 8,
  };
}

interface LedgerState {
  payments: Map<string, Payment>;
  refunds: Map<string, PaymentRefund[]>;
  /** Existing projection rows, to find what must go. */
  pointerRevs: Map<string, number>;
  lineKeys: Set<string>;
  bucketValues: Map<string, { n: number; amountCents: number; tipsCents: number; feesCents: number }>;
  hasIndex: boolean;
}

const emptyState = (): LedgerState => ({
  payments: new Map(),
  refunds: new Map(),
  pointerRevs: new Map(),
  lineKeys: new Set(),
  bucketValues: new Map(),
  hasIndex: false,
});

function take(state: LedgerState, item: Record<string, unknown>): void {
  const pk = item.PK as string;
  const sk = item.SK as string;
  if (pk.startsWith('PAYMENT#')) {
    if (sk === METADATA_SK) {
      const p = stripKeys<Payment>(item)!;
      state.payments.set(p.id, p);
    } else if (sk.startsWith(REFUND_SK_PREFIX)) {
      const r = stripKeys<PaymentRefund>(item)!;
      const list = state.refunds.get(r.paymentId) ?? [];
      list.push(r);
      state.refunds.set(r.paymentId, list);
    } else if (sk === PAYMENT_REPORT_POINTER_SK) {
      state.pointerRevs.set(pk.slice('PAYMENT#'.length), Number(item.rev) || 0);
    }
  } else if (pk.startsWith('PAYLINE#')) {
    state.lineKeys.add(`${pk}|${sk}`);
  } else if (pk.startsWith('PAYAGG#')) {
    state.bucketValues.set(`${pk}|${sk}`, {
      n: Number(item.n) || 0,
      amountCents: Number(item.amountCents) || 0,
      tipsCents: Number(item.tipsCents) || 0,
      feesCents: Number(item.feesCents) || 0,
    });
  } else if (pk === PAYREPORT_INDEX_PK) {
    state.hasIndex = true;
  }
}

/** An import package's `billing/part-*.jsonl` — the same rows the loader writes to DynamoDB. */
async function readJsonl(dir: string): Promise<LedgerState> {
  const state = emptyState();
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .sort();
  for (const f of files) {
    const rl = createInterface({ input: createReadStream(resolve(dir, f)), crlfDelay: Infinity });
    for await (const line of rl) {
      if (!line.startsWith('{"PK":"PAYMENT#')) continue;
      take(state, JSON.parse(line));
    }
  }
  return state;
}

async function scanTable(db: DynamoDbService, segments: number): Promise<LedgerState> {
  const state = emptyState();
  let read = 0;
  await Promise.all(
    Array.from({ length: segments }, async (_, segment) => {
      let ExclusiveStartKey: Record<string, unknown> | undefined;
      do {
        const res = await db.client.send(
          new ScanCommand({
            TableName: BILLING_TABLE,
            Segment: segment,
            TotalSegments: segments,
            FilterExpression:
              'begins_with(PK, :pay) OR begins_with(PK, :line) OR begins_with(PK, :agg) OR PK = :idx',
            ExpressionAttributeValues: {
              ':pay': 'PAYMENT#',
              ':line': 'PAYLINE#',
              ':agg': 'PAYAGG#',
              ':idx': PAYREPORT_INDEX_PK,
            },
            ExclusiveStartKey,
          }),
        );
        for (const item of res.Items ?? []) take(state, item);
        read += res.ScannedCount ?? 0;
        ExclusiveStartKey = res.LastEvaluatedKey;
      } while (ExclusiveStartKey);
    }),
  );
  console.log(`scanned ${read.toLocaleString('en-US')} rows of ${BILLING_TABLE}`);
  return state;
}

/** dealId → lead technician, service area, job number — via deal-service's internal list. */
async function loadDeals(): Promise<Map<string, LineDims>> {
  const out = new Map<string, LineDims>();
  let cursor: string | undefined;
  do {
    const url = `${DEAL_SERVICE_URL}/api/deals/internal/all?limit=500${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const res = await fetch(url, { headers: { 'x-internal-secret': INTERNAL_SERVICE_SECRET } });
    if (!res.ok) throw new Error(`deal-service internal/all answered ${res.status}`);
    const body = (await res.json()) as { data?: { items?: Deal[]; nextCursor?: string } };
    for (const d of body.data?.items ?? []) {
      out.set(d.id, {
        ...(d.assignedTechIds?.[0] && { technicianId: d.assignedTechIds[0] }),
        ...(d.serviceAreaId && { serviceAreaId: d.serviceAreaId }),
        ...(d.dealNumber && { dealNumber: d.dealNumber }),
      });
    }
    cursor = body.data?.nextCursor;
  } while (cursor);
  console.log(`deals: ${out.size.toLocaleString('en-US')}`);
  return out;
}

async function batchWrite(db: DynamoDbService, requests: Array<Record<string, unknown>>, label: string): Promise<void> {
  const chunks: Array<Array<Record<string, unknown>>> = [];
  for (let i = 0; i < requests.length; i += 25) chunks.push(requests.slice(i, i + 25));
  let done = 0;
  const worker = async () => {
    for (let chunk = chunks.shift(); chunk; chunk = chunks.shift()) {
      let pending = chunk;
      for (let attempt = 0; pending.length; attempt++) {
        const res = await db.client.send(new BatchWriteCommand({ RequestItems: { [BILLING_TABLE]: pending as never } }));
        pending = (res.UnprocessedItems?.[BILLING_TABLE] as Array<Record<string, unknown>> | undefined) ?? [];
        if (pending.length) await new Promise((r) => setTimeout(r, Math.min(2000, 50 * 2 ** attempt)));
      }
      done += chunk.length;
      if (done % 20_000 < 25) console.log(`  ${label}: ${done.toLocaleString('en-US')}`);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`${label}: ${requests.length.toLocaleString('en-US')} done`);
}

function printTotals(built: BuiltProjection, args: Args): void {
  const today = businessDay(new Date().toISOString(), PAYMENT_REPORT_TZ);
  const from = args.from ?? `${today.slice(0, 7)}-01`;
  const to = args.to ?? today;
  const rows = bucketRowsFor(built, aggregatePlan(from, to));
  const totals = totalsFrom(rows, { types: expandTypes(args.types), technicianIds: [], serviceAreaIds: [] });
  const money = (n: number) =>
    `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  console.log(`\nPayments report ${from} … ${to} (${PAYMENT_REPORT_TZ})`);
  console.log('| Type | Count | Amount | Tips |');
  console.log('|---|---:|---:|---:|');
  for (const [type, t] of Object.entries(totals.byType).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`| ${paymentReportTypeLabel(type)} (${type}) | ${t.count} | ${money(t.amount)} | ${money(t.tips)} |`);
  }
  console.log(`| **Total** | **${totals.count}** | **${money(totals.amount)}** | **${money(totals.tips)}** |`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const d of [args.from, args.to]) {
    if (d !== undefined && !isDay(d)) throw new Error(`not a date (YYYY-MM-DD): ${d}`);
  }

  if (args.jsonl) {
    const state = await readJsonl(args.jsonl);
    console.log(
      `ledger: ${state.payments.size.toLocaleString('en-US')} payments, ` +
        `${[...state.refunds.values()].reduce((n, l) => n + l.length, 0).toLocaleString('en-US')} refunds`,
    );
    const built = buildProjection(state.payments.values(), state.refunds);
    console.log(`projection: ${built.lines.length.toLocaleString('en-US')} lines, ${built.buckets.size.toLocaleString('en-US')} buckets, ${built.firstMonth} … ${built.lastMonth}`);
    printTotals(built, args);
    return;
  }

  const db = new DynamoDbService();
  const state = await scanTable(db, args.segments);
  const deals = args.noDeals ? new Map<string, LineDims>() : await loadDeals();
  const built = buildProjection(state.payments.values(), state.refunds, deals);

  const lineKeys = new Set(built.lines.map((l) => `${l.pointer.pk}|${l.pointer.sk}`));
  const staleLines = [...state.lineKeys].filter((k) => !lineKeys.has(k));
  const staleBuckets = [...state.bucketValues.keys()].filter((k) => !built.buckets.has(k));
  const stalePointers = [...state.pointerRevs.keys()].filter((id) => !built.pointers.has(id));
  const drift = [...built.buckets.entries()].filter(([k, b]) => {
    const cur = state.bucketValues.get(k);
    return (
      !cur ||
      cur.n !== b.c.n ||
      cur.amountCents !== b.c.amountCents ||
      cur.tipsCents !== b.c.tipsCents ||
      cur.feesCents !== b.c.feesCents
    );
  }).length;

  console.log(
    `ledger: ${state.payments.size.toLocaleString('en-US')} payments; projection: ` +
      `${built.lines.length.toLocaleString('en-US')} lines, ${built.buckets.size.toLocaleString('en-US')} buckets ` +
      `(${drift.toLocaleString('en-US')} new or different), stale: ${staleLines.length} lines, ` +
      `${staleBuckets.length} buckets, ${stalePointers.length} pointers`,
  );
  printTotals(built, args);
  if (args.dryRun) {
    console.log('\n--dry-run: nothing written');
    return;
  }

  const now = new Date().toISOString();
  await batchWrite(
    db,
    built.lines.map(({ line, pointer }) => ({
      PutRequest: { Item: { PK: pointer.pk, SK: pointer.sk, entityType: 'payment_report_line', ...line } },
    })),
    'lines',
  );
  await batchWrite(
    db,
    [...built.pointers.entries()].map(([paymentId, lines]) => ({
      PutRequest: {
        Item: {
          PK: paymentPk(paymentId),
          SK: PAYMENT_REPORT_POINTER_SK,
          entityType: 'payment_report_pointer',
          paymentId,
          lines,
          // Past whatever a live projection read, so one in flight re-reads.
          rev: (state.pointerRevs.get(paymentId) ?? 0) + 1,
          updatedAt: now,
        },
      },
    })),
    'pointers',
  );
  await batchWrite(
    db,
    [...built.buckets.values()].map((b) => ({
      PutRequest: {
        Item: {
          PK: b.pk,
          SK: b.sk,
          entityType: 'payment_report_bucket',
          period: b.period,
          bucket: b.bucket,
          ...b.c,
        },
      },
    })),
    'buckets',
  );
  await batchWrite(
    db,
    [
      ...staleLines.map((k) => k.split('|')),
      ...staleBuckets.map((k) => k.split('|')),
      ...stalePointers.map((id) => [paymentPk(id), PAYMENT_REPORT_POINTER_SK]),
    ].map(([PK, SK]) => ({ DeleteRequest: { Key: { PK, SK } } })),
    'stale rows removed',
  );
  if (built.firstMonth && built.lastMonth) {
    await batchWrite(
      db,
      [
        {
          PutRequest: {
            Item: {
              PK: PAYREPORT_INDEX_PK,
              SK: PAYREPORT_INDEX_SK,
              entityType: 'payment_report_index',
              firstMonth: built.firstMonth,
              lastMonth: built.lastMonth,
            },
          },
        },
      ],
      'index',
    );
  }
  console.log('\npayment report rebuilt');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
