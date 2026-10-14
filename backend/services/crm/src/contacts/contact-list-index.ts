/**
 * GSI2 ContactListIndex — the client list (`GET /contacts`, `/contacts/count`
 * without `companyId`) as a key:
 *
 *   GSI2PK = CONTACTS#ACTIVE
 *   GSI2SK = <"first last" trimmed, lowercased, first 200 chars>#<id>
 *
 * Sparse: on a contact's METADATA row exactly while `status = active` — the
 * one condition the list's Scan has always filtered on. Sorted by the name
 * the web's Clients grid shows A→Z by default, so a server page arrives in
 * the order it is displayed (the Scan answered in hash order).
 *
 * Written by the repository alone — on `create` and after every `update`
 * (recomputed from the whole row, written only when it differs) — never by a
 * caller. It is a derived projection: `backfill:contact-list-index`
 * reconciles it (sets the keys where missing or stale AND removes them where
 * a row no longer qualifies), then stamps the readiness row.
 */
export const CONTACT_LIST_PK = 'CONTACTS#ACTIVE';

/**
 * The readiness row: `CONTACTLISTINDEX / STATE { readyAt, count }`, stamped
 * by `backfill:contact-list-index -- --apply` after a complete reconcile
 * (never by a dry run). Until it exists the list and its count keep Scanning,
 * so deploying before Terraform or before the backfill is safe.
 */
export const CONTACT_LIST_STATE_KEY = { PK: 'CONTACTLISTINDEX', SK: 'STATE' } as const;

/** A cursor of the index Query names the table keys and the GSI2 keys. */
export const CONTACT_LIST_CURSOR_KEYS = ['PK', 'SK', 'GSI2PK', 'GSI2SK'] as const;

/** The row attributes the keys are computed from. */
export const CONTACT_LIST_INPUTS: readonly string[] = ['status', 'firstName', 'lastName'];

/**
 * How much of the name orders the row. An index key holds at most 1 024
 * bytes; 200 characters (≤ 800 bytes) keep any name well inside that.
 */
const SORT_NAME_CHARS = 200;

const CONTACT_PREFIX = 'CONTACT#';

export interface ContactListKeys {
  GSI2PK: string;
  GSI2SK: string;
}

type Row = Record<string, unknown>;

function sortName(row: Row): string {
  const first = typeof row.firstName === 'string' ? row.firstName : '';
  const last = typeof row.lastName === 'string' ? row.lastName : '';
  const name = `${first.trim()} ${last.trim()}`.trim().toLowerCase();
  return [...name].slice(0, SORT_NAME_CHARS).join('');
}

/** The keys a row should carry, or nothing when it is not an active contact. */
export function contactListKeys(row: Row): ContactListKeys | undefined {
  if (row.SK !== 'METADATA' || typeof row.PK !== 'string' || !row.PK.startsWith(CONTACT_PREFIX)) {
    return undefined;
  }
  if (row.status !== 'active') return undefined;
  const id = typeof row.id === 'string' && row.id ? row.id : row.PK.slice(CONTACT_PREFIX.length);
  return { GSI2PK: CONTACT_LIST_PK, GSI2SK: `${sortName(row)}#${id}` };
}

export type ContactListPlan = { action: 'same' } | { action: 'set'; pk: string; sk: string } | { action: 'remove' };

/** What one row needs: nothing, its keys set (or re-set), or its keys removed. */
export function planContactList(row: Row): ContactListPlan {
  const keys = contactListKeys(row);
  if (keys) {
    return row.GSI2PK === keys.GSI2PK && row.GSI2SK === keys.GSI2SK
      ? { action: 'same' }
      : { action: 'set', pk: keys.GSI2PK, sk: keys.GSI2SK };
  }
  return row.GSI2PK === undefined && row.GSI2SK === undefined ? { action: 'same' } : { action: 'remove' };
}

/**
 * The UpdateCommand parts that apply a plan, guarded on the inputs exactly as
 * they were when the plan was made: a rename or a delete that landed in
 * between fails the condition instead of filing the row under keys computed
 * from a row that no longer exists. The caller re-reads and plans again.
 */
export function contactListWrite(
  row: Row,
  plan: Exclude<ContactListPlan, { action: 'same' }>,
): {
  UpdateExpression: string;
  ConditionExpression: string;
  ExpressionAttributeNames: Record<string, string>;
  ExpressionAttributeValues?: Record<string, unknown>;
} {
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const conditions = ['attribute_exists(PK)'];
  for (const attr of CONTACT_LIST_INPUTS) {
    names[`#cl_${attr}`] = attr;
    if (row[attr] === undefined) {
      conditions.push(`attribute_not_exists(#cl_${attr})`);
    } else {
      conditions.push(`#cl_${attr} = :cl_${attr}`);
      values[`:cl_${attr}`] = row[attr];
    }
  }
  if (plan.action === 'set') {
    values[':gsi2pk'] = plan.pk;
    values[':gsi2sk'] = plan.sk;
  }
  return {
    UpdateExpression: plan.action === 'set' ? 'SET GSI2PK = :gsi2pk, GSI2SK = :gsi2sk' : 'REMOVE GSI2PK, GSI2SK',
    ConditionExpression: conditions.join(' AND '),
    ExpressionAttributeNames: names,
    ...(Object.keys(values).length > 0 && { ExpressionAttributeValues: values }),
  };
}

/** Whether a decoded cursor was handed out by the index Query (not by the old Scan). */
export function hasContactListCursorKeys(key: Record<string, unknown> | undefined): boolean {
  return !!key && CONTACT_LIST_CURSOR_KEYS.every((k) => typeof key[k] === 'string');
}

/** DynamoDB's answer to a Query on an index the table does not have (yet). */
export function isMissingIndexError(err: unknown): boolean {
  const e = err as { name?: string; message?: string } | undefined;
  return e?.name === 'ValidationException' && /index/i.test(e.message ?? '');
}
