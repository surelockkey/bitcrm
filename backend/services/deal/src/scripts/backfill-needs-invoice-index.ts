/**
 * Reconcile the NeedsInvoiceIndex (GSI11) keys on every deal METADATA row.
 *
 * WHY
 * ---
 * Billing's invoice summaries count, and list, the jobs that still need an
 * invoice: live, at least one line (`itemCount > 0`), no `invoiceId`. That
 * used to be `GET /deals?needsInvoice=true` — a Scan of the whole deals
 * table, capped at 100. GSI11 (`NEEDS_INVOICE` / `<createdAt>#DEAL#<id>`) is
 * that condition as a sparse key; the repository writes it on create and on
 * every update that touches `status`, `itemCount` or `invoiceId`. Rows
 * written before the index existed — every imported Workiz job — have none.
 *
 * WHAT
 * ----
 * A derived projection, so this RECONCILES rather than backfills
 * (backend/CLAUDE.md §5): it sets the keys on rows that qualify and lack them
 * AND removes them from rows that carry them but no longer qualify — a key
 * that got in wrongly must be able to leave. Keys and rules are the
 * repository's own (`deals/needs-invoice-index.ts`). Each write is guarded on
 * the inputs as the scan saw them: a job edited mid-run was restamped by its
 * own write and is reported as skipped, never overwritten. Idempotent: a
 * second run changes nothing but the readiness stamp.
 *
 * READINESS
 * ---------
 * A complete `--apply` run ends by stamping `NEEDSINVOICEINDEX / STATE
 * { readyAt, count }`. Until that row exists the readers keep their old paths
 * (the public list Scans; billing's internal routes answer 404 so billing
 * falls back), so deal-service can ship before Terraform and this backfill.
 *
 * USAGE
 * -----
 *   npm run backfill:needs-invoice-index -w backend/services/deal              # dry run
 *   npm run backfill:needs-invoice-index -w backend/services/deal -- --apply
 *
 * Needs the index first: Terraform (`infra/dev/data_plane.tf`, NeedsInvoiceIndex
 * n = 11) or `npm run setup:db` locally. Run it after the deploy that ships the
 * index and again after every Workiz import.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  NEEDS_INVOICE_STATE_KEY,
  needsInvoiceKeys,
  needsInvoiceWrite,
  planNeedsInvoice,
  type NeedsInvoicePlan,
} from '../deals/needs-invoice-index';

const PARALLEL = 25;

type Send = (command: ScanCommand | UpdateCommand | PutCommand) => Promise<any>;
type Row = Record<string, unknown> & { PK: string; SK: string };

export interface ReconcileResult {
  scanned: number;
  same: number;
  set: number;
  removed: number;
  /** Changed under the run (condition failed) — their own write restamped them. */
  skipped: number;
  /** Rows that need an invoice as scanned — the readiness row's `count`. */
  qualifying: number;
  /** When `--apply` stamped `NEEDSINVOICEINDEX / STATE` (never on a dry run). */
  readyAt?: string;
}

async function write(send: Send, table: string, row: Row, plan: Exclude<NeedsInvoicePlan, { action: 'same' }>): Promise<boolean> {
  try {
    await send(new UpdateCommand({ TableName: table, Key: { PK: row.PK, SK: row.SK }, ...needsInvoiceWrite(row, plan) }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export async function reconcileNeedsInvoice(
  send: Send,
  opts: { table: string; apply: boolean; log?: (line: string) => void },
): Promise<ReconcileResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const out: ReconcileResult = { scanned: 0, same: 0, set: 0, removed: 0, skipped: 0, qualifying: 0 };
  let lastKey: Record<string, unknown> | undefined;
  let shown = 0;

  do {
    const page = await send(
      new ScanCommand({
        TableName: opts.table,
        FilterExpression: 'SK = :meta AND begins_with(PK, :deal)',
        ExpressionAttributeValues: { ':meta': 'METADATA', ':deal': 'DEAL#' },
        ProjectionExpression: 'PK, SK, id, createdAt, #status, itemCount, invoiceId, GSI11PK, GSI11SK',
        ExpressionAttributeNames: { '#status': 'status' },
        ExclusiveStartKey: lastKey,
      }),
    );

    const todo: { row: Row; plan: Exclude<NeedsInvoicePlan, { action: 'same' }> }[] = [];
    for (const row of (page.Items ?? []) as Row[]) {
      out.scanned += 1;
      if (needsInvoiceKeys(row)) out.qualifying += 1;
      const plan = planNeedsInvoice(row);
      if (plan.action === 'same') out.same += 1;
      else todo.push({ row, plan });
    }

    if (!opts.apply) {
      for (const t of todo) {
        if (t.plan.action === 'set') out.set += 1;
        else out.removed += 1;
        if (shown++ < 10) log(`would ${t.plan.action} ${t.row.PK}${t.plan.action === 'set' ? `: ${t.plan.sk}` : ''}`);
      }
    } else {
      for (let i = 0; i < todo.length; i += PARALLEL) {
        const slice = todo.slice(i, i + PARALLEL);
        const results = await Promise.all(slice.map((t) => write(send, opts.table, t.row, t.plan)));
        results.forEach((ok, j) => {
          if (!ok) out.skipped += 1;
          else if (slice[j].plan.action === 'set') out.set += 1;
          else out.removed += 1;
        });
      }
    }
    lastKey = page.LastEvaluatedKey;
    if (out.scanned % 20_000 < (page.Items?.length ?? 0)) log(`… ${out.scanned} deals scanned`);
  } while (lastKey);

  // The whole table reconciled: the readers may switch to the index. A run
  // that threw never gets here, and a dry run never stamps.
  if (opts.apply) {
    out.readyAt = new Date().toISOString();
    await send(
      new PutCommand({
        TableName: opts.table,
        Item: { ...NEEDS_INVOICE_STATE_KEY, readyAt: out.readyAt, count: out.qualifying },
      }),
    );
    log(`Stamped ${NEEDS_INVOICE_STATE_KEY.PK} / ${NEEDS_INVOICE_STATE_KEY.SK}: readyAt ${out.readyAt}, count ${out.qualifying}`);
  }
  return out;
}

async function main(): Promise<void> {
  const table = process.env.DEALS_TABLE || 'BitCRM_Deals';
  const apply = process.argv.includes('--apply');
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
  );
  console.log(`Table: ${table}`);
  console.log(`Mode:  ${apply ? 'APPLY' : 'DRY RUN (pass --apply to write)'}\n`);
  const r = await reconcileNeedsInvoice((c) => client.send(c as never), { table, apply });
  console.log(
    `\nScanned ${r.scanned} deals: ${r.set} ${apply ? 'filed' : 'to file'}, ${r.removed} ${apply ? 'removed' : 'to remove'}, ` +
      `${r.same} already correct` +
      (apply ? `, ${r.skipped} skipped (edited during the run — their own write restamped them)` : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-needs-invoice-index failed:', err);
    process.exit(1);
  });
}
