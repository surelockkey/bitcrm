import { attachmentContactKeys, timelineContactKeys, type ContactIndexKeys } from './contact-index';

/** What the backfill reads off each row — enough to key it, no more. */
export const CONTACT_BACKFILL_PROJECTION = ['PK', 'SK', 'id', 'timestamp', 'uploadedAt'];

/** Scan filter: a job's timeline and attachment rows without the contact key yet. */
export const CONTACT_BACKFILL_FILTER =
  'begins_with(PK, :d) AND (begins_with(SK, :t) OR begins_with(SK, :a)) AND attribute_not_exists(GSI10PK)';
export const CONTACT_BACKFILL_FILTER_VALUES = { ':d': 'DEAL#', ':t': 'TIMELINE#', ':a': 'ATTACH#' };

type Row = Record<string, unknown>;

/** The job a row belongs to, off its partition key; undefined off anything that is not a job's. */
export function dealIdOfRow(row: Row): string | undefined {
  const pk = typeof row.PK === 'string' ? row.PK : '';
  return pk.startsWith('DEAL#') ? pk.slice('DEAL#'.length) : undefined;
}

export interface ContactBackfillUpdate {
  kind: 'timeline' | 'attachment';
  input: Record<string, unknown>;
}

/**
 * The UpdateItem that files one row under the job's client, or null when the
 * row cannot be keyed (no client, no time, no id, not a timeline or attachment
 * row). Upsert-only and idempotent: the condition never overwrites keys the
 * live writer already put there and never brings back a row deleted meanwhile.
 */
export function contactIndexBackfillUpdate(row: Row, contactId: string, tableName: string): ContactBackfillUpdate | null {
  if (!contactId || typeof row.id !== 'string' || !row.id) return null;
  const sk = typeof row.SK === 'string' ? row.SK : '';
  let kind: ContactBackfillUpdate['kind'];
  let keys: ContactIndexKeys;
  if (sk.startsWith('TIMELINE#')) {
    if (typeof row.timestamp !== 'string' || !row.timestamp) return null;
    kind = 'timeline';
    keys = timelineContactKeys(contactId, row.timestamp, row.id);
  } else if (sk.startsWith('ATTACH#')) {
    if (typeof row.uploadedAt !== 'string' || !row.uploadedAt) return null;
    kind = 'attachment';
    keys = attachmentContactKeys(contactId, row.uploadedAt, row.id);
  } else {
    return null;
  }
  const fields: Record<string, string> = { ...keys, contactId };
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries(fields).map(([attr, value], i) => {
    names[`#f${i}`] = attr;
    values[`:f${i}`] = value;
    return `#f${i} = :f${i}`;
  });
  return {
    kind,
    input: {
      TableName: tableName,
      Key: { PK: row.PK, SK: row.SK },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(GSI10PK)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    },
  };
}
