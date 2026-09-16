import {
  AutomationScheduleRepository,
  type ScheduledFiring,
} from '../../../../src/automations/engine/schedule.repository';
import { conditionalCheckFailed, mockDynamo } from '../../mocks';

const firing = (over: Partial<ScheduledFiring> = {}): ScheduledFiring => ({
  ruleId: 'r1',
  entity: 'deal:d1',
  occurrence: 'status:x',
  dueAt: '2026-09-17T12:00:00.000Z',
  dealId: 'd1',
  reason: 'quiet_hours',
  event: '{"kind":"deal.status_changed","at":"2026-09-17T03:00:00.000Z"}',
  createdAt: '2026-09-17T03:00:00.000Z',
  ...over,
});

describe('AutomationScheduleRepository', () => {
  it('arms a firing in its UTC minute bucket, once', async () => {
    const { dynamo, sent } = mockDynamo([{}, conditionalCheckFailed()]);
    const repo = new AutomationScheduleRepository(dynamo);

    expect(await repo.arm(firing())).toBe(true);
    expect(sent[0]).toMatchObject({
      name: 'PutCommand',
      input: {
        Item: expect.objectContaining({
          PK: 'SCHEDULE#2026-09-17T12:00',
          SK: 'r1#deal:d1#status:x',
          reason: 'quiet_hours',
        }),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });
    expect(sent[0].input.Item.expiresAt).toBe(
      Math.floor(new Date('2026-09-17T12:00:00.000Z').getTime() / 1000) + 30 * 24 * 60 * 60,
    );
    expect(await repo.arm(firing())).toBe(false);
  });

  it('reads a minute, following pages', async () => {
    const { dynamo, sent } = mockDynamo([
      { Items: [{ PK: 'SCHEDULE#2026-09-17T12:00', SK: 'r1#deal:d1#status:x', expiresAt: 1, ...firing() }], LastEvaluatedKey: { PK: 'x' } },
      { Items: [] },
    ]);
    const items = await new AutomationScheduleRepository(dynamo).dueIn('2026-09-17T12:00');
    expect(items).toEqual([firing()]);
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'SCHEDULE#2026-09-17T12:00' });
    expect(sent).toHaveLength(2);
  });

  it('removes a firing by its own key', async () => {
    const { dynamo, sent } = mockDynamo();
    await new AutomationScheduleRepository(dynamo).remove(firing());
    expect(sent[0]).toMatchObject({
      name: 'DeleteCommand',
      input: { Key: { PK: 'SCHEDULE#2026-09-17T12:00', SK: 'r1#deal:d1#status:x' } },
    });
  });
});
