import { AccountClock } from '@bitcrm/types';
import { activityBackfillUpdate } from 'src/activity/activity-backfill';

const clock = new AccountClock();

describe('backfill:activity-index — one row', () => {
  const row = {
    PK: 'ACCOUNT#workiz#2026-06',
    SK: 'ACT#2026-06-16T16:07:00.600Z#x1',
    id: 'x1',
    eventType: 'workiz_activity',
    actorId: 'u-karina',
    timestamp: '2026-06-16T16:07:00.600Z',
    note: 'Added number (888) 839-0362',
    details: { source: 'workiz', workiz: { text: 'Added number (888) 839-0362', native: false } },
    source: 'workiz',
    externalId: 'workiz:activity:8e29a193:0',
  };

  it('sets the keys and the search text, only where no keys are yet, and on a row that still exists', () => {
    const update = activityBackfillUpdate(row, clock, 'BitCRM_Deals')!;
    expect(update.day).toBe('2026-06-16');
    const input = update.input as Record<string, any>;
    expect(input.Key).toEqual({ PK: row.PK, SK: row.SK });
    expect(input.ConditionExpression).toBe('attribute_exists(PK) AND attribute_not_exists(GSI8PK)');
    const written = Object.fromEntries(
      Object.entries(input.ExpressionAttributeNames as Record<string, string>).map(([k, attr]) => [
        attr,
        input.ExpressionAttributeValues[`:${k.slice(1)}`],
      ]),
    );
    expect(written).toEqual({
      GSI8PK: 'ACTDAY#2026-06-16',
      GSI8SK: '2026-06-16T16:07:00.600Z#x1',
      GSI9PK: 'ACTOR#u-karina',
      GSI9SK: '2026-06-16T16:07:00.600Z#x1',
      activitySearch: 'added number (888) 839-0362',
    });
  });

  it('skips a Workiz comment', () => {
    expect(activityBackfillUpdate({ ...row, externalId: 'workiz:note:1' }, clock, 'BitCRM_Deals')).toBeNull();
  });
});
