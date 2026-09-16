import { type AutomationRun } from '@bitcrm/types';
import { AutomationRunsRepository } from '../../../../src/automations/engine/automation-runs.repository';
import { conditionalCheckFailed, mockDynamo, T1 } from '../../mocks';

const run = (over: Partial<AutomationRun> = {}): AutomationRun => ({
  id: 'run-1',
  ruleId: 'r1',
  firedAt: T1,
  trigger: 'deal.status_changed',
  entity: 'deal:d1',
  dealId: 'd1',
  occurrence: 'status:submitted>done',
  outcome: 'sent',
  actions: [{ type: 'send_sms', to: 'client', outcome: 'sent', messageId: 'm1' }],
  ...over,
});

describe('AutomationRunsRepository', () => {
  it('claims a firing once — the second caller is told it is taken', async () => {
    const { dynamo, sent } = mockDynamo([{}, conditionalCheckFailed()]);
    const repo = new AutomationRunsRepository(dynamo);

    expect(await repo.claim('r1', 'deal:d1', 'status:x', T1)).toBe(true);
    expect(await repo.claim('r1', 'deal:d1', 'status:x', T1)).toBe(false);

    expect(sent[0]).toMatchObject({
      name: 'PutCommand',
      input: {
        Item: expect.objectContaining({ PK: 'AUTORUN#r1', SK: 'ONCE#deal:d1#status:x', ruleId: 'r1' }),
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });
    // 90 days of TTL on the marker.
    expect(sent[0].input.Item.expiresAt).toBe(Math.floor(new Date(T1).getTime() / 1000) + 90 * 24 * 60 * 60);
  });

  it('rethrows anything that is not a lost race', async () => {
    const { dynamo } = mockDynamo([new Error('throttled')]);
    const repo = new AutomationRunsRepository(dynamo);
    await expect(repo.claim('r1', 'deal:d1', 'o')).rejects.toThrow('throttled');
  });

  it('releases a claim so the next delivery may retry', async () => {
    const { dynamo, sent } = mockDynamo();
    await new AutomationRunsRepository(dynamo).release('r1', 'deal:d1', 'status:x');
    expect(sent[0]).toMatchObject({
      name: 'DeleteCommand',
      input: { Key: { PK: 'AUTORUN#r1', SK: 'ONCE#deal:d1#status:x' } },
    });
  });

  it('logs a firing under RUN#<firedAt>#<id> with a 30-day TTL', async () => {
    const { dynamo, sent } = mockDynamo();
    await new AutomationRunsRepository(dynamo).log(run());
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toMatchObject({
      PK: 'AUTORUN#r1',
      SK: `RUN#${T1}#run-1`,
      outcome: 'sent',
      expiresAt: Math.floor(new Date(T1).getTime() / 1000) + 30 * 24 * 60 * 60,
    });
  });

  it('lists a rule\'s firings newest first, without the TTL attribute', async () => {
    const { dynamo, sent } = mockDynamo([
      { Items: [{ PK: 'AUTORUN#r1', SK: `RUN#${T1}#run-1`, expiresAt: 1, ...run() }] },
    ]);
    const runs = await new AutomationRunsRepository(dynamo).listByRule('r1', 5);
    expect(runs).toEqual([run()]);
    expect(sent[0]).toMatchObject({
      name: 'QueryCommand',
      input: {
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': 'AUTORUN#r1', ':sk': 'RUN#' },
        ScanIndexForward: false,
        Limit: 5,
      },
    });
  });

  it('bumps the rule counter atomically and swallows a missing row', async () => {
    const { dynamo, sent } = mockDynamo([{}, conditionalCheckFailed()]);
    const repo = new AutomationRunsRepository(dynamo);
    await repo.bump('r1', T1);
    expect(sent[0]).toMatchObject({
      name: 'UpdateCommand',
      input: {
        Key: { PK: 'AUTOMATION#r1', SK: 'METADATA' },
        UpdateExpression: 'ADD firedCount :one SET lastFiredAt = :at',
        ExpressionAttributeValues: { ':one': 1, ':at': T1 },
      },
    });
    await expect(repo.bump('builtin-never-stored', T1)).resolves.toBeUndefined();
  });
});
