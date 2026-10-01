import {
  CONTACT_BACKFILL_FILTER,
  CONTACT_BACKFILL_FILTER_VALUES,
  CONTACT_BACKFILL_PROJECTION,
  contactIndexBackfillUpdate,
  dealIdOfRow,
} from 'src/contacts/contact-index-backfill';

const written = (input: Record<string, any>) =>
  Object.fromEntries(
    Object.entries(input.ExpressionAttributeNames as Record<string, string>).map(([k, attr]) => [
      attr,
      input.ExpressionAttributeValues[`:${k.slice(1)}`],
    ]),
  );

/**
 * `backfill:contact-index` files the rows written before GSI10 existed: every
 * TIMELINE# and ATTACH# row under a DEAL# partition without GSI10PK gets the
 * keys of the deal's client. The planning is pure so the script, and anyone
 * re-running it, apply exactly the writer's rules.
 */
describe('backfill:contact-index — planning', () => {
  it('scans only job partitions’ timeline and attachment rows that have no contact key yet', () => {
    expect(CONTACT_BACKFILL_FILTER).toBe(
      'begins_with(PK, :d) AND (begins_with(SK, :t) OR begins_with(SK, :a)) AND attribute_not_exists(GSI10PK)',
    );
    expect(CONTACT_BACKFILL_FILTER_VALUES).toEqual({ ':d': 'DEAL#', ':t': 'TIMELINE#', ':a': 'ATTACH#' });
    expect(CONTACT_BACKFILL_PROJECTION).toEqual(['PK', 'SK', 'id', 'timestamp', 'uploadedAt']);
  });

  it('reads the job off the partition key', () => {
    expect(dealIdOfRow({ PK: 'DEAL#d-1', SK: 'TIMELINE#x' })).toBe('d-1');
    expect(dealIdOfRow({ PK: 'CLIENT#c-1', SK: 'ACT#x' })).toBeUndefined();
  });

  it('a timeline row gets CONTACT#<contactId> / <timestamp>#<id>, plus contactId, conditionally', () => {
    const row = { PK: 'DEAL#d-1', SK: 'TIMELINE#2026-09-01T10:00:00.000Z#ev-1', id: 'ev-1', timestamp: '2026-09-01T10:00:00.000Z' };
    const update = contactIndexBackfillUpdate(row, 'c-1', 'bitcrm-dev-deals')!;
    expect(update.kind).toBe('timeline');
    expect(update.input).toMatchObject({
      TableName: 'bitcrm-dev-deals',
      Key: { PK: row.PK, SK: row.SK },
      ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(GSI10PK)',
    });
    expect(written(update.input)).toEqual({
      GSI10PK: 'CONTACT#c-1',
      GSI10SK: '2026-09-01T10:00:00.000Z#ev-1',
      contactId: 'c-1',
    });
  });

  it('an attachment row gets CONTACTFILE#<contactId> / <uploadedAt>#<id>', () => {
    const row = { PK: 'DEAL#d-1', SK: 'ATTACH#att-1', id: 'att-1', uploadedAt: '2026-07-30T10:00:00.000Z' };
    const update = contactIndexBackfillUpdate(row, 'c-1', 'BitCRM_Deals')!;
    expect(update.kind).toBe('attachment');
    expect(written(update.input)).toEqual({
      GSI10PK: 'CONTACTFILE#c-1',
      GSI10SK: '2026-07-30T10:00:00.000Z#att-1',
      contactId: 'c-1',
    });
  });

  it('a row that cannot be keyed is skipped: no time, no id, a job with no client, or neither kind', () => {
    expect(contactIndexBackfillUpdate({ PK: 'DEAL#d-1', SK: 'TIMELINE#x', id: 'ev-1' }, 'c-1', 't')).toBeNull();
    expect(contactIndexBackfillUpdate({ PK: 'DEAL#d-1', SK: 'ATTACH#a', uploadedAt: '2026-01-01T00:00:00.000Z' }, 'c-1', 't')).toBeNull();
    expect(
      contactIndexBackfillUpdate({ PK: 'DEAL#d-1', SK: 'TIMELINE#x', id: 'ev-1', timestamp: '2026-01-01T00:00:00.000Z' }, '', 't'),
    ).toBeNull();
    expect(contactIndexBackfillUpdate({ PK: 'DEAL#d-1', SK: 'METADATA', id: 'd-1' }, 'c-1', 't')).toBeNull();
  });
});
