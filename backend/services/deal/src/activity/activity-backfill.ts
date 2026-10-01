import type { AccountClock } from '@bitcrm/types';
import { activityIndexFields } from './activity-index';

/** What the backfill reads off each timeline row — enough to key it, no more. */
export const ACTIVITY_BACKFILL_PROJECTION = [
  'PK', 'SK', 'id', 'dealId', 'timestamp', 'actorId', 'eventType', 'details', 'note', 'source', 'externalId',
];

/** Scan filter: timeline rows without the day key yet. */
export const ACTIVITY_BACKFILL_FILTER = '(begins_with(SK, :t) OR begins_with(SK, :a)) AND attribute_not_exists(GSI8PK)';
export const ACTIVITY_BACKFILL_FILTER_VALUES = { ':t': 'TIMELINE#', ':a': 'ACT#' };

/**
 * The UpdateItem that files one row in the Activity indexes, or null when the
 * row is not an Activity event. Upsert-only and idempotent: it never
 * overwrites keys the live writer already put there (a row written after the
 * deploy) and never brings back a row deleted meanwhile.
 */
export function activityBackfillUpdate(
  item: Record<string, unknown>,
  clock: AccountClock,
  tableName: string,
): { input: Record<string, unknown>; day: string } | null {
  const fields = activityIndexFields(item, clock);
  if (!fields) return null;
  const names: Record<string, string> = {};
  const values: Record<string, unknown> = {};
  const sets = Object.entries(fields).map(([attr, value], i) => {
    names[`#f${i}`] = attr;
    values[`:f${i}`] = value;
    return `#f${i} = :f${i}`;
  });
  return {
    day: fields.GSI8PK.slice('ACTDAY#'.length),
    input: {
      TableName: tableName,
      Key: { PK: item.PK, SK: item.SK },
      UpdateExpression: `SET ${sets.join(', ')}`,
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(GSI8PK)',
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
    },
  };
}
