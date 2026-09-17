import {
  DealSnapshotRepository,
  isReschedule,
  snapshotOf,
} from '../../../../src/automations/engine/deal-snapshot.repository';
import { mockDynamo, T1 } from '../../mocks';

const deal = {
  id: 'd1',
  scheduledDate: '2026-09-20',
  scheduledEndDate: '2026-09-20',
  scheduledTimeSlot: '09:00-11:00',
};

describe('DealSnapshotRepository', () => {
  it('reads and writes DEALSNAP#<dealId> with a TTL', async () => {
    const snapshot = snapshotOf(deal, T1);
    const { dynamo, sent } = mockDynamo([{ Item: { PK: 'DEALSNAP#d1', SK: 'METADATA', expiresAt: 1, ...snapshot } }]);
    const repo = new DealSnapshotRepository(dynamo);

    expect(await repo.get('d1')).toEqual(snapshot);
    await repo.put(snapshot);
    expect(sent[1]).toMatchObject({
      name: 'PutCommand',
      input: { Item: expect.objectContaining({ PK: 'DEALSNAP#d1', SK: 'METADATA', scheduledDate: '2026-09-20' }) },
    });
    expect(sent[1].input.Item.expiresAt).toBe(Math.floor(new Date(T1).getTime() / 1000) + 180 * 24 * 60 * 60);
  });

  it('answers null for a job never seen', async () => {
    const { dynamo } = mockDynamo([{}]);
    expect(await new DealSnapshotRepository(dynamo).get('d9')).toBeNull();
  });
});

describe('isReschedule', () => {
  const previous = snapshotOf(deal, T1);

  it('is false the first time a job is seen', () => {
    expect(isReschedule(null, previous)).toBe(false);
  });

  it('is false for an edit that left the schedule alone', () => {
    expect(isReschedule(previous, snapshotOf({ ...deal }, '2026-09-16T10:00:00.000Z'))).toBe(false);
  });

  it('is true for a new date, a new end date or a new slot', () => {
    expect(isReschedule(previous, snapshotOf({ ...deal, scheduledDate: '2026-09-21' }, T1))).toBe(true);
    expect(isReschedule(previous, snapshotOf({ ...deal, scheduledEndDate: '2026-09-21' }, T1))).toBe(true);
    expect(isReschedule(previous, snapshotOf({ ...deal, scheduledTimeSlot: '13:00-15:00' }, T1))).toBe(true);
  });

  it('is true when a scheduled job becomes unscheduled', () => {
    expect(isReschedule(previous, snapshotOf({ id: 'd1' }, T1))).toBe(true);
  });
});
