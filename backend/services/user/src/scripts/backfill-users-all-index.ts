/**
 * Reconcile the all-users index keys (`GSI3PK = USERS#ALL`, `GSI3SK =
 * USER#<id>` on TechnicianIndex) on every user METADATA row.
 *
 * WHY
 * ---
 * "Every user" — `GET /users/internal/all` (telephony's directory, messaging's
 * role lookups, the search backfill), the unfiltered Users page, search, the
 * dispatch roster — was a filtered Scan of the users table, which also holds
 * every technician's job types, areas, commission versions, documents,
 * calendar events and audit rows. The repository now writes the keys on
 * `create`; rows written before (every existing user, every imported one)
 * have none.
 *
 * WHAT
 * ----
 * A derived projection, so this RECONCILES rather than backfills
 * (backend/CLAUDE.md §5): it sets the keys on user rows that lack them or hold
 * wrong ones AND removes them from any other row carrying `USERS#ALL`. The
 * keys derive from the row's own PK alone, so the only race is a row deleted
 * mid-run: every set is conditional on the row existing (never resurrects
 * one), every remove on the key still being ours. Technician profile rows
 * (`GSI3PK = TECHNICIAN`) are never touched. Idempotent.
 *
 * READINESS
 * ---------
 * A complete `--apply` run ends by stamping `USERSALLINDEX / STATE
 * { readyAt, count }`. Until that row exists the readers keep the Scan, so
 * user-service can ship before this has run.
 *
 * USAGE
 * -----
 *   npm run backfill:users-all-index -w backend/services/user              # dry run
 *   npm run backfill:users-all-index -w backend/services/user -- --apply
 *
 * No Terraform: TechnicianIndex (GSI3) exists already. Run it after the deploy
 * that ships the index, and again after every Workiz users import (a Put that
 * rewrites a METADATA row without the keys drops it from the index).
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  ALL_USERS_GSI_PK,
  ALL_USERS_INDEX_STATE_KEY,
  allUsersGsiSk,
} from '../users/constants/dynamo.constants';

const PARALLEL = 25;

type Send = (command: ScanCommand | UpdateCommand | PutCommand) => Promise<any>;
type Row = Record<string, unknown> & { PK: string; SK: string };

export interface UsersAllIndexResult {
  scanned: number;
  /** User METADATA rows — the readiness row's `count`. */
  users: number;
  same: number;
  set: number;
  removed: number;
  /** The row went (or changed its key) during the run. */
  skipped: number;
  readyAt?: string;
}

const isUserRow = (r: Row) => r.SK === 'METADATA' && String(r.PK).startsWith('USER#');

type Plan = { action: 'same' } | { action: 'set'; sk: string } | { action: 'remove' };

function plan(row: Row): Plan {
  if (isUserRow(row)) {
    const sk = allUsersGsiSk(String(row.PK).slice('USER#'.length));
    return row.GSI3PK === ALL_USERS_GSI_PK && row.GSI3SK === sk ? { action: 'same' } : { action: 'set', sk };
  }
  return row.GSI3PK === ALL_USERS_GSI_PK ? { action: 'remove' } : { action: 'same' };
}

async function write(send: Send, table: string, row: Row, p: Exclude<Plan, { action: 'same' }>): Promise<boolean> {
  const input =
    p.action === 'set'
      ? {
          UpdateExpression: 'SET GSI3PK = :pk, GSI3SK = :sk',
          ExpressionAttributeValues: { ':pk': ALL_USERS_GSI_PK, ':sk': p.sk },
          ConditionExpression: 'attribute_exists(PK)',
        }
      : {
          UpdateExpression: 'REMOVE GSI3PK, GSI3SK',
          ExpressionAttributeValues: { ':pk': ALL_USERS_GSI_PK },
          ConditionExpression: 'GSI3PK = :pk',
        };
  try {
    await send(new UpdateCommand({ TableName: table, Key: { PK: row.PK, SK: row.SK }, ...input }));
    return true;
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
    throw err;
  }
}

export async function reconcileUsersAllIndex(
  send: Send,
  opts: { table: string; apply: boolean; log?: (line: string) => void },
): Promise<UsersAllIndexResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const out: UsersAllIndexResult = { scanned: 0, users: 0, same: 0, set: 0, removed: 0, skipped: 0 };
  let lastKey: Record<string, unknown> | undefined;
  let shown = 0;

  do {
    const page = await send(
      new ScanCommand({
        TableName: opts.table,
        FilterExpression: '(SK = :meta AND begins_with(PK, :user)) OR GSI3PK = :all',
        ExpressionAttributeValues: { ':meta': 'METADATA', ':user': 'USER#', ':all': ALL_USERS_GSI_PK },
        ProjectionExpression: 'PK, SK, GSI3PK, GSI3SK',
        ExclusiveStartKey: lastKey,
      }),
    );

    const todo: { row: Row; p: Exclude<Plan, { action: 'same' }> }[] = [];
    for (const row of (page.Items ?? []) as Row[]) {
      out.scanned += 1;
      if (isUserRow(row)) out.users += 1;
      const p = plan(row);
      if (p.action === 'same') {
        if (isUserRow(row)) out.same += 1;
      } else {
        todo.push({ row, p });
      }
    }

    if (!opts.apply) {
      for (const t of todo) {
        if (t.p.action === 'set') out.set += 1;
        else out.removed += 1;
        if (shown++ < 10) log(`would ${t.p.action} ${t.row.PK} / ${t.row.SK}`);
      }
    } else {
      for (let i = 0; i < todo.length; i += PARALLEL) {
        const slice = todo.slice(i, i + PARALLEL);
        const results = await Promise.all(slice.map((t) => write(send, opts.table, t.row, t.p)));
        results.forEach((ok, j) => {
          if (!ok) out.skipped += 1;
          else if (slice[j].p.action === 'set') out.set += 1;
          else out.removed += 1;
        });
      }
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);

  // The whole table reconciled: the readers may switch. A run that threw
  // never gets here, and a dry run never stamps.
  if (opts.apply) {
    out.readyAt = new Date().toISOString();
    await send(
      new PutCommand({
        TableName: opts.table,
        Item: { ...ALL_USERS_INDEX_STATE_KEY, readyAt: out.readyAt, count: out.users },
      }),
    );
    log(`Stamped ${ALL_USERS_INDEX_STATE_KEY.PK} / ${ALL_USERS_INDEX_STATE_KEY.SK}: readyAt ${out.readyAt}, count ${out.users}`);
  }
  return out;
}

async function main(): Promise<void> {
  const table = process.env.USERS_TABLE || 'BitCRM_Users';
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
  const r = await reconcileUsersAllIndex((c) => client.send(c as never), { table, apply });
  console.log(
    `\nScanned ${r.scanned} rows (${r.users} users): ${r.set} ${apply ? 'filed' : 'to file'}, ` +
      `${r.removed} ${apply ? 'removed' : 'to remove'}, ${r.same} already correct` +
      (apply ? `, ${r.skipped} skipped (deleted during the run)` : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-users-all-index failed:', err);
    process.exit(1);
  });
}
