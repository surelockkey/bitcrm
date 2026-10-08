/**
 * Stamp the jobs-list search attributes onto every deal METADATA row.
 *
 * WHY
 * ---
 * `GET /deals?q=` (Workiz's Search box) matches `contains()` on four
 * attributes of the row (`deals/deal-search.ts`): the job's own half
 * (`searchText` / `searchDigits` — Job ID, job name, the "Just here" name,
 * street / city / state / zip, the job's email, company and numbers) and the
 * client's half (`clientSearchText` / `clientSearchDigits` — the crm
 * contact's name, emails, company title and numbers). deal-service writes them
 * on create, on every update of an input, on a client change / merge and on
 * crm's `contact.updated`. Rows written before that — every imported Workiz
 * job — carry none, and a row without them is never found by the box.
 *
 * WHAT
 * ----
 * 1. Reads crm's companies (`COMPANY#<id>` / METADATA → title) and contacts
 *    (`CONTACT#<id>` / METADATA → name, phones, emails, company) straight from
 *    their tables and folds each contact into its client half, in memory.
 * 2. Scans the deals table in `--segments` parallel segments, METADATA rows
 *    only, projected to the inputs; computes both halves with the very
 *    functions the service uses, and writes only what differs. A contact the
 *    crm table does not hold leaves the client half untouched.
 * 3. Each write is conditional on the row's `updatedAt` as the scan saw it: a
 *    job edited mid-run was restamped by its own write and is reported as
 *    skipped, never overwritten with stale values. Idempotent, upsert-only
 *    (backend/CLAUDE.md §5) — a second run writes nothing.
 *
 * USAGE
 * -----
 *   npm run backfill:deal-search -w backend/services/deal                      # dry run: counts + samples
 *   npm run backfill:deal-search -w backend/services/deal -- --apply
 *     [--segments 8]       parallel Scan segments over the deals table
 *     [--concurrency 50]   writes in flight
 *
 * Dev (tables `bitcrm-dev-*`):
 *   AWS_PROFILE=bitcrm-dev AWS_REGION=us-east-1 DYNAMODB_ENDPOINT= \
 *   DEALS_TABLE=bitcrm-dev-deals CONTACTS_TABLE=bitcrm-dev-contacts COMPANIES_TABLE=bitcrm-dev-companies \
 *   npm run backfill:deal-search -w backend/services/deal [-- --apply]
 *
 * Run it after the deploy that ships the search and again after every Workiz
 * import (the importer does not stamp these). No index is involved, so no
 * Terraform is needed first.
 *
 * TIME / COST (the full Workiz import: 368 320 jobs in a table of ~10.8 M items,
 * most of them timeline rows): the Scan reads the whole table once (~8 GB,
 * ≈ 1 M read units, a few minutes over 8 segments; only matching rows' projected
 * attributes cross the wire), the contacts table once (~770 k items, seconds),
 * then one UpdateItem per job (≈ 4–5 write units on the row plus the same on
 * each of its ~6 ALL-projected GSIs ≈ 12 M write units). From a laptop expect
 * ~10–20 minutes, mostly write round trips and throttling back-off. Dev holds
 * a ~5 k-job slice: seconds.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import {
  DEAL_SEARCH_INPUTS,
  clientSearchAttributes,
  dealSearchAttributes,
  type ClientSearchAttributes,
  type DealSearchAttributes,
} from '../deals/deal-search';

const DEALS_TABLE = process.env.DEALS_TABLE || 'BitCRM_Deals';
const CONTACTS_TABLE = process.env.CONTACTS_TABLE || 'BitCRM_Contacts';
const COMPANIES_TABLE = process.env.COMPANIES_TABLE || 'BitCRM_Companies';
const APPLY = process.argv.includes('--apply');

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}
const SEGMENTS = flag('segments', 8);
const CONCURRENCY = flag('concurrency', 50);

const client = DynamoDBDocumentClient.from(
  new DynamoDBClient({
    region: process.env.AWS_REGION || 'us-east-1',
    // Every update is also written to each GSI the row projects into (~6), so a
    // full run can meet throttling; the SDK backs off and retries instead of
    // failing the run on the third attempt.
    maxAttempts: 10,
    ...(process.env.DYNAMODB_ENDPOINT && {
      endpoint: process.env.DYNAMODB_ENDPOINT,
      credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
    }),
  }),
);

type Row = Record<string, unknown> & { PK: string; SK: string; contactId?: string; updatedAt?: string };
type SearchAttrs = Partial<DealSearchAttributes & ClientSearchAttributes>;

/** What one row needs: nothing, or the attributes that differ from what it holds. */
export function planDealSearch(row: Row, clientHalf: ClientSearchAttributes | undefined): { action: 'same' } | { action: 'set'; attrs: SearchAttrs } {
  const wanted: SearchAttrs = { ...dealSearchAttributes(row), ...clientHalf };
  const attrs: SearchAttrs = {};
  for (const [key, value] of Object.entries(wanted) as [keyof SearchAttrs, string][]) {
    if (row[key] !== value) attrs[key] = value;
  }
  return Object.keys(attrs).length ? { action: 'set', attrs } : { action: 'same' };
}

/** One crm contact row → `[contactId, its client half]`. */
export function clientIndexEntry(
  contact: { id: string; firstName?: string; lastName?: string; phones?: unknown; emails?: unknown; companyId?: string },
  companies: Map<string, string>,
): [string, ClientSearchAttributes] {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return [
    contact.id,
    clientSearchAttributes(
      { firstName: contact.firstName, lastName: contact.lastName, phones: list(contact.phones), emails: list(contact.emails) },
      contact.companyId ? companies.get(contact.companyId) : undefined,
    ),
  ];
}

/** Every METADATA row of one key prefix in a table, projected, over `segments` parallel Scan segments. */
async function scanMetadata(
  table: string,
  prefix: string,
  attributes: string[],
  segments: number,
  onPage: (rows: Row[]) => Promise<void>,
): Promise<void> {
  const names: Record<string, string> = {};
  const projection = ['PK', 'SK', ...attributes]
    .map((attr, i) => {
      names[`#p${i}`] = attr;
      return `#p${i}`;
    })
    .join(', ');
  await Promise.all(
    Array.from({ length: segments }, async (_, segment) => {
      let lastKey: Record<string, unknown> | undefined;
      do {
        const page = await client.send(
          new ScanCommand({
            TableName: table,
            Segment: segment,
            TotalSegments: segments,
            FilterExpression: '#sk = :meta AND begins_with(#pk, :prefix)',
            ExpressionAttributeNames: { ...names, '#pk': 'PK', '#sk': 'SK' },
            ExpressionAttributeValues: { ':meta': 'METADATA', ':prefix': prefix },
            ProjectionExpression: projection,
            ExclusiveStartKey: lastKey,
          }),
        );
        await onPage((page.Items ?? []) as Row[]);
        lastKey = page.LastEvaluatedKey;
      } while (lastKey);
    }),
  );
}

async function write(row: Row, attrs: SearchAttrs): Promise<'stamped' | 'skipped'> {
  const keys = Object.keys(attrs);
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = keys.map((key, i) => {
    names[`#a${i}`] = key;
    values[`:a${i}`] = attrs[key as keyof SearchAttrs];
    return `#a${i} = :a${i}`;
  });
  if (row.updatedAt) values[':seen'] = row.updatedAt;
  try {
    await client.send(
      new UpdateCommand({
        TableName: DEALS_TABLE,
        Key: { PK: row.PK, SK: row.SK },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: row.updatedAt
          ? 'attribute_exists(PK) AND updatedAt = :seen'
          : 'attribute_exists(PK) AND attribute_not_exists(updatedAt)',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }),
    );
    return 'stamped';
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return 'skipped';
    throw err;
  }
}

async function main(): Promise<void> {
  const started = Date.now();
  console.log(`Deals:     ${DEALS_TABLE}`);
  console.log(`Contacts:  ${CONTACTS_TABLE}`);
  console.log(`Companies: ${COMPANIES_TABLE}`);
  console.log(`Mode:      ${APPLY ? 'APPLY' : 'DRY RUN'} (segments ${SEGMENTS}, concurrency ${CONCURRENCY})\n`);

  const companies = new Map<string, string>();
  await scanMetadata(COMPANIES_TABLE, 'COMPANY#', ['id', 'title'], 2, async (rows) => {
    for (const r of rows) if (typeof r.id === 'string' && typeof r.title === 'string') companies.set(r.id, r.title);
  });
  console.log(`${companies.size} companies read`);

  const clients = new Map<string, ClientSearchAttributes>();
  await scanMetadata(CONTACTS_TABLE, 'CONTACT#', ['id', 'firstName', 'lastName', 'phones', 'emails', 'companyId'], SEGMENTS, async (rows) => {
    for (const r of rows) {
      if (typeof r.id !== 'string') continue;
      const [id, half] = clientIndexEntry(r as unknown as Parameters<typeof clientIndexEntry>[0], companies);
      clients.set(id, half);
    }
  });
  console.log(`${clients.size} contacts read\n`);

  let scanned = 0;
  let same = 0;
  let stamped = 0;
  let skipped = 0;
  let noClient = 0;
  let samples = 0;
  const inputs = ['id', 'contactId', 'updatedAt', ...DEAL_SEARCH_INPUTS, 'searchText', 'searchDigits', 'clientSearchText', 'clientSearchDigits'];

  await scanMetadata(DEALS_TABLE, 'DEAL#', inputs, SEGMENTS, async (rows) => {
    const todo: { row: Row; attrs: SearchAttrs }[] = [];
    for (const row of rows) {
      scanned += 1;
      const half = row.contactId ? clients.get(row.contactId) : undefined;
      if (!half) noClient += 1;
      const plan = planDealSearch(row, half);
      if (plan.action === 'same') same += 1;
      else todo.push({ row, attrs: plan.attrs });
    }
    if (!APPLY) {
      stamped += todo.length;
      for (const t of todo) {
        if (samples >= 5) break;
        samples += 1;
        console.log(`would set ${t.row.PK}: ${JSON.stringify(t.attrs)}`);
      }
    } else {
      for (let i = 0; i < todo.length; i += CONCURRENCY) {
        const results = await Promise.all(todo.slice(i, i + CONCURRENCY).map((t) => write(t.row, t.attrs)));
        stamped += results.filter((r) => r === 'stamped').length;
        skipped += results.filter((r) => r === 'skipped').length;
      }
    }
    if (scanned % 20_000 < rows.length) console.log(`… ${scanned} deals scanned (${Math.round((Date.now() - started) / 1000)} s)`);
  });

  console.log(
    `\nScanned ${scanned} deals in ${Math.round((Date.now() - started) / 1000)} s: ${stamped} ${APPLY ? 'stamped' : 'to stamp'}, ` +
      `${same} already correct, ${noClient} whose client crm does not hold (own half only)` +
      (APPLY ? `, ${skipped} skipped (edited during the run — their own write stamped their half; run again for the client half)` : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-deal-search failed:', err);
    process.exit(1);
  });
}
