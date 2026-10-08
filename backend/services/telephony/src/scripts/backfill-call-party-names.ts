/**
 * Stamp `partyNames` — what the call log's Search box matches — onto every
 * call row whose parties are frozen.
 *
 * WHY
 * ---
 * `GET /calls?q=` matches a party's NAME with `contains(partyNames, …)`
 * (calls/call-search.ts). Call rows store their parties as ids only, so the
 * names are copied on: the log's own read path stamps them whenever it has
 * just named a finished call and the row disagrees. Rows nobody has opened
 * since that shipped — every imported Workiz call — carry none, and a row
 * without them is found by its digits only, never by a name.
 *
 * WHAT
 * ----
 * 1. Reads the names straight from their tables, into memory: users
 *    (`USER#<id>` → first + last name, else the email — as UserNamesService
 *    prints them), crm contacts (`CONTACT#<id>` → "First Last") and companies
 *    (`COMPANY#<id>` → title — as crm's `internal/by-ids` prints them).
 * 2. Scans the calls table in `--segments` parallel segments, `CALL#…` /
 *    METADATA rows only, projected to the frozen party fields; computes the
 *    text with the very functions the service uses (`storedParties`,
 *    `partyNamesText`) and writes only what differs.
 * 3. Leaves alone: a row with no frozen association (its first read resolves
 *    it by number, freezes it and stamps it), a row naming a party none of the
 *    tables holds any more, and the hidden internal leg. Each write is
 *    conditional on the row existing. Idempotent, upsert-only
 *    (backend/CLAUDE.md §5): a second run writes nothing.
 *
 * USAGE
 * -----
 *   npm run backfill:call-party-names -w backend/services/telephony                 # dry run: counts + samples
 *   npm run backfill:call-party-names -w backend/services/telephony -- --apply
 *     [--segments 8]       parallel Scan segments over the calls table
 *     [--concurrency 50]   writes in flight
 *
 * Dev (tables `bitcrm-dev-*`):
 *   AWS_PROFILE=bitcrm-dev AWS_REGION=us-east-1 DYNAMODB_ENDPOINT= \
 *   CALLS_TABLE=bitcrm-dev-calls USERS_TABLE=bitcrm-dev-users \
 *   CONTACTS_TABLE=bitcrm-dev-contacts COMPANIES_TABLE=bitcrm-dev-companies \
 *   npm run backfill:call-party-names -w backend/services/telephony [-- --apply]
 *
 * Run it after the deploy that ships the search, and again after every Workiz
 * import (the importer does not stamp `partyNames`). No index is involved, so
 * no Terraform is needed first.
 *
 * TIME / COST (the full import: ~1.8 M calls, ~1.6 M of them with a frozen
 * client): one Scan of the calls table (a few GB), one of contacts (~770 k
 * rows) and of users/companies (small), then one UpdateItem per stamped call
 * — the row plus its ALL-projected GSIs (AgentIndex, AllCallsIndex,
 * PartyIndex) ≈ 4 writes each. From a laptop expect ~15–30 minutes, mostly
 * write round trips. Dev holds a slice: seconds.
 */
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../../.env') });

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { storedParties } from '../calls/party-resolver';
import { partyNamesText } from '../calls/call-search';
import { type CallRecord } from '../calls/calls.repository';

const CALLS_TABLE = process.env.CALLS_TABLE || 'BitCRM_Calls';
const USERS_TABLE = process.env.USERS_TABLE || 'BitCRM_Users';
const CONTACTS_TABLE = process.env.CONTACTS_TABLE || 'BitCRM_Contacts';
const COMPANIES_TABLE = process.env.COMPANIES_TABLE || 'BitCRM_Companies';

/** Every name a frozen party can carry, by id. */
export interface NameBook {
  users: Map<string, string>;
  contacts: Map<string, string>;
  companies: Map<string, string>;
}

/** A user as UserNamesService prints them: first + last name, else the email. */
export function userName(u: { firstName?: string; lastName?: string; email?: string }): string | undefined {
  const full = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
  return full || u.email || undefined;
}

/** A contact as crm's `internal/by-ids` prints them. */
export function contactName(c: { firstName?: string; lastName?: string }): string {
  return `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
}

type Row = Partial<CallRecord> & { PK: string };

/** What one row needs. */
export function planPartyNames(
  row: Row,
  book: NameBook,
): { action: 'same' } | { action: 'set'; partyNames: string } | { action: 'unfrozen' } | { action: 'unknown' } {
  // The receiving side of an internal call is never listed, so never searched.
  if (row.internalLegOf) return { action: 'same' };
  const stored = storedParties(row as CallRecord);
  if (!stored.from && !stored.to) return { action: 'unfrozen' };

  const nameOf = (party: (typeof stored)['from']): string | undefined | null => {
    if (!party) return null;
    if (party.kind === 'user') return book.users.get(party.id);
    if (party.kind === 'company') return book.companies.get(party.id);
    return book.contacts.get(party.id);
  };
  const from = nameOf(stored.from);
  const to = nameOf(stored.to);
  // A party none of the tables holds: the read path names nobody either and
  // writes nothing — guessing here would only be undone.
  if (from === undefined || to === undefined) return { action: 'unknown' };

  const partyNames = partyNamesText([from ?? undefined, to ?? undefined]);
  return partyNames === (row.partyNames ?? '') ? { action: 'same' } : { action: 'set', partyNames };
}

function flag(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const n = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const segments = flag('segments', 8);
  const concurrency = flag('concurrency', 50);
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({
      region: process.env.AWS_REGION || 'us-east-1',
      // Each stamp is also written to the row's three ALL-projected indexes;
      // back off on throttling rather than fail the run.
      maxAttempts: 10,
      ...(process.env.DYNAMODB_ENDPOINT && {
        endpoint: process.env.DYNAMODB_ENDPOINT,
        credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
      }),
    }),
  );

  /** Every METADATA row of one key prefix in a table, projected, over parallel Scan segments. */
  const scanMetadata = async (
    table: string,
    prefix: string,
    attributes: string[],
    segs: number,
    onPage: (rows: Row[]) => Promise<void>,
  ): Promise<void> => {
    const names: Record<string, string> = {};
    const projection = ['PK', 'SK', ...attributes]
      .map((attr, i) => {
        names[`#p${i}`] = attr;
        return `#p${i}`;
      })
      .join(', ');
    await Promise.all(
      Array.from({ length: segs }, async (_, segment) => {
        let lastKey: Record<string, unknown> | undefined;
        do {
          const page = await client.send(
            new ScanCommand({
              TableName: table,
              Segment: segment,
              TotalSegments: segs,
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
  };

  const started = Date.now();
  console.log(`Calls:     ${CALLS_TABLE}`);
  console.log(`Users:     ${USERS_TABLE}`);
  console.log(`Contacts:  ${CONTACTS_TABLE}`);
  console.log(`Companies: ${COMPANIES_TABLE}`);
  console.log(`Mode:      ${apply ? 'APPLY' : 'DRY RUN'} (segments ${segments}, concurrency ${concurrency})\n`);

  const book: NameBook = { users: new Map(), contacts: new Map(), companies: new Map() };
  const id = (r: Row) => (r as { id?: unknown }).id;
  await scanMetadata(USERS_TABLE, 'USER#', ['id', 'firstName', 'lastName', 'email'], 2, async (rows) => {
    for (const r of rows) {
      const name = userName(r as never);
      if (typeof id(r) === 'string' && name) book.users.set(id(r) as string, name);
    }
  });
  await scanMetadata(COMPANIES_TABLE, 'COMPANY#', ['id', 'title'], 2, async (rows) => {
    for (const r of rows) {
      const title = (r as { title?: unknown }).title;
      if (typeof id(r) === 'string' && typeof title === 'string') book.companies.set(id(r) as string, title);
    }
  });
  await scanMetadata(CONTACTS_TABLE, 'CONTACT#', ['id', 'firstName', 'lastName'], segments, async (rows) => {
    for (const r of rows) if (typeof id(r) === 'string') book.contacts.set(id(r) as string, contactName(r as never));
  });
  console.log(`${book.users.size} users, ${book.companies.size} companies, ${book.contacts.size} contacts read\n`);

  const counts = { scanned: 0, same: 0, stamped: 0, unfrozen: 0, unknown: 0, gone: 0 };
  let samples = 0;
  const write = async (row: Row, partyNames: string): Promise<boolean> => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: CALLS_TABLE,
          Key: { PK: row.PK, SK: 'METADATA' },
          UpdateExpression: partyNames ? 'SET #partyNames = :names' : 'REMOVE #partyNames',
          ConditionExpression: 'attribute_exists(PK)',
          ExpressionAttributeNames: { '#partyNames': 'partyNames' },
          ...(partyNames && { ExpressionAttributeValues: { ':names': partyNames } }),
        }),
      );
      return true;
    } catch (err) {
      if ((err as { name?: string }).name === 'ConditionalCheckFailedException') return false;
      throw err;
    }
  };

  const inputs = [
    'internalLegOf',
    'partyNames',
    'fromPartyKind',
    'fromPartyId',
    'fromPartyPersonal',
    'toPartyKind',
    'toPartyId',
    'toPartyPersonal',
  ];
  await scanMetadata(CALLS_TABLE, 'CALL#', inputs, segments, async (rows) => {
    const todo: { row: Row; partyNames: string }[] = [];
    for (const row of rows) {
      counts.scanned += 1;
      const plan = planPartyNames(row, book);
      if (plan.action === 'set') todo.push({ row, partyNames: plan.partyNames });
      else counts[plan.action] += 1;
    }
    if (!apply) {
      counts.stamped += todo.length;
      for (const t of todo) {
        if (samples >= 5) break;
        samples += 1;
        console.log(`would set ${t.row.PK}: ${JSON.stringify(t.partyNames)}`);
      }
    } else {
      for (let i = 0; i < todo.length; i += concurrency) {
        const results = await Promise.all(todo.slice(i, i + concurrency).map((t) => write(t.row, t.partyNames)));
        counts.stamped += results.filter(Boolean).length;
        counts.gone += results.filter((ok) => !ok).length;
      }
    }
    if (counts.scanned % 50_000 < rows.length) {
      console.log(`… ${counts.scanned} calls scanned (${Math.round((Date.now() - started) / 1000)} s)`);
    }
  });

  console.log(
    `\nScanned ${counts.scanned} calls in ${Math.round((Date.now() - started) / 1000)} s: ` +
      `${counts.stamped} ${apply ? 'stamped' : 'to stamp'}, ${counts.same} already correct, ` +
      `${counts.unfrozen} with no frozen party (named on their first read), ` +
      `${counts.unknown} naming a party no table holds` +
      (apply ? `, ${counts.gone} gone before the write` : '') +
      '.',
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error('backfill-call-party-names failed:', err);
    process.exit(1);
  });
}
