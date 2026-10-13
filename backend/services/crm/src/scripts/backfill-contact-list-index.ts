/**
 * Reconcile the ContactListIndex (GSI2) keys on every contact METADATA row.
 *
 * WHY
 * ---
 * `GET /contacts` and `/contacts/count` (no `companyId`) Scanned the whole
 * contacts table — contact rows, PHONE# pointers and NOTE# rows alike — and
 * kept the active contacts. GSI2 (`CONTACTS#ACTIVE` / `<name>#<id>`) is that
 * condition as a sparse key, in the A→Z order the Clients grid shows; the
 * repository writes it on create and after every update. Rows written before
 * the index existed — every imported Workiz client — have none.
 *
 * WHAT
 * ----
 * A derived projection, so this RECONCILES rather than backfills
 * (backend/CLAUDE.md §5): it sets the keys on active rows that lack them or
 * carry a stale name AND removes them from rows that carry them but are no
 * longer active. Keys and rules are the repository's own
 * (`contacts/contact-list-index.ts`). Each write is guarded on the inputs as
 * the scan saw them: a contact edited mid-run was re-filed by its own write
 * and is reported as skipped, never overwritten. Idempotent: a second run
 * changes nothing but the readiness stamp.
 *
 * READINESS
 * ---------
 * A complete `--apply` run ends by stamping `CONTACTLISTINDEX / STATE
 * { readyAt, count }`. Until that row exists the list and its count keep
 * Scanning, so crm can ship before Terraform and before this backfill.
 *
 * USAGE
 * -----
 *   npm run backfill:contact-list-index -w backend/services/crm              # dry run
 *   npm run backfill:contact-list-index -w backend/services/crm -- --apply
 *
 * Needs the index first: Terraform (`infra/dev/data_plane.tf`, contacts
 * ContactListIndex n = 2) or `npm run setup:db` locally. Run it after the
 * deploy that ships the index and again after every Workiz client import
 * (the import writes the rows directly, without the keys).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  CONTACT_LIST_STATE_KEY,
  contactListKeys,
  contactListWrite,
  planContactList,
  type ContactListPlan,
} from '../contacts/contact-list-index';

const PARALLEL = 25;

type Send = (command: ScanCommand | UpdateCommand | PutCommand) => Promise<any>;
type Row = Record<string, unknown> & { PK: string; SK: string };

export interface ReconcileResult {
  scanned: number;
  same: number;
  set: number;
  removed: number;
  /** Changed under the run (condition failed) — their own write re-filed them. */
  skipped: number;
  /** Active contacts as scanned — the readiness row's `count`. */
  qualifying: number;
  /** When `--apply` stamped `CONTACTLISTINDEX / STATE` (never on a dry run). */
  readyAt?: string;
}

async function write(send: Send, table: string, row: Row, plan: Exclude<ContactListPlan, { action: 'same' }>): Promise<boolean> {
  try {
    await send(new UpdateCommand({ TableName: table, Key: { PK: row.PK, SK: row.SK }, ...contactListWrite(row, plan) }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export async function reconcileContactList(
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
        FilterExpression: 'SK = :meta AND begins_with(PK, :contact)',
        ExpressionAttributeValues: { ':meta': 'METADATA', ':contact': 'CONTACT#' },
        ProjectionExpression: 'PK, SK, id, #status, firstName, lastName, GSI2PK, GSI2SK',
        ExpressionAttributeNames: { '#status': 'status' },
        ExclusiveStartKey: lastKey,
      }),
    );

    const todo: { row: Row; plan: Exclude<ContactListPlan, { action: 'same' }> }[] = [];
    for (const row of (page.Items ?? []) as Row[]) {
      out.scanned += 1;
      if (contactListKeys(row)) out.qualifying += 1;
      const plan = planContactList(row);
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
  } while (lastKey);

  // The whole table reconciled: the list may switch to the index. A run that
  // threw never gets here, and a dry run never stamps.
  if (opts.apply) {
    out.readyAt = new Date().toISOString();
    await send(
      new PutCommand({
        TableName: opts.table,
        Item: { ...CONTACT_LIST_STATE_KEY, readyAt: out.readyAt, count: out.qualifying },
      }),
    );
    log(`Stamped ${CONTACT_LIST_STATE_KEY.PK} / ${CONTACT_LIST_STATE_KEY.SK}: readyAt ${out.readyAt}, count ${out.qualifying}`);
  }
  return out;
}

async function main(): Promise<void> {
  const table = process.env.CONTACTS_TABLE || 'BitCRM_Contacts';
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
  const r = await reconcileContactList((c) => client.send(c as never), { table, apply });
  console.log(
    `\nScanned ${r.scanned} contacts (${r.qualifying} active): ${r.set} ${apply ? 'filed' : 'to file'}, ` +
      `${r.removed} ${apply ? 'removed' : 'to remove'}, ${r.same} already correct` +
      (apply ? `, ${r.skipped} skipped (edited during the run — their own write re-filed them)` : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-contact-list-index failed:', err);
    process.exit(1);
  });
}
