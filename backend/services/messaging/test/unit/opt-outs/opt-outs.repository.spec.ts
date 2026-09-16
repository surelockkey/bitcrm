import { OptOutsRepository } from '../../../src/opt-outs/opt-outs.repository';
import { T0, T1, conditionalCheckFailed, createMockOptOut, mockDynamo } from '../mocks';

function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new OptOutsRepository(dynamo), sent };
}

const stored = (overrides = {}) => ({
  Item: { PK: 'OPTOUT#sms#+14045551234', SK: 'METADATA', ...createMockOptOut(), ...overrides },
});

describe('OptOutsRepository', () => {
  it('reads OPTOUT#<channel>#<address> and answers the pre-send check', async () => {
    const { repo, sent } = makeRepo([stored(), {}, stored({ status: 'opted_in' })]);
    expect(await repo.isOptedOut('sms', '+14045551234')).toBe(true);
    expect(await repo.isOptedOut('sms', '+15550000000')).toBe(false);
    expect(await repo.isOptedOut('sms', '+14045551234')).toBe(false);
    expect(sent[0].name).toBe('GetCommand');
    expect(sent[0].input.Key).toEqual({ PK: 'OPTOUT#sms#+14045551234', SK: 'METADATA' });
    expect(sent[1].input.Key).toEqual({ PK: 'OPTOUT#sms#+15550000000', SK: 'METADATA' });
  });

  it('first STOP creates the row with a single history entry and an existence guard', async () => {
    const { repo, sent } = makeRepo([{}, {}]);
    const row = await repo.setStatus({ channel: 'sms', address: '+14045551234', status: 'opted_out', source: 'advanced_opt_out', keyword: 'STOP', at: T0 });

    expect(sent.map((s) => s.name)).toEqual(['GetCommand', 'PutCommand']);
    expect(sent[1].input.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(sent[1].input.Item).toEqual({
      PK: 'OPTOUT#sms#+14045551234',
      SK: 'METADATA',
      channel: 'sms',
      address: '+14045551234',
      status: 'opted_out',
      keyword: 'STOP',
      source: 'advanced_opt_out',
      updatedAt: T0,
      history: [{ status: 'opted_out', source: 'advanced_opt_out', keyword: 'STOP', at: T0 }],
    });
    expect(row.history).toHaveLength(1);
  });

  it('START prepends to history, keeps the messaging service sid and guards on updatedAt', async () => {
    const { repo, sent } = makeRepo([stored({ messagingServiceSid: 'MG1' }), {}]);
    const row = await repo.setStatus({ channel: 'sms', address: '+14045551234', status: 'opted_in', source: 'advanced_opt_out', keyword: 'START', at: T1 });

    expect(sent[1].input.ConditionExpression).toBe('#updatedAt = :expected');
    expect(sent[1].input.ExpressionAttributeValues).toEqual({ ':expected': T0 });
    expect(row).toMatchObject({ status: 'opted_in', keyword: 'START', messagingServiceSid: 'MG1', updatedAt: T1 });
    expect(row.history.map((h) => h.status)).toEqual(['opted_in', 'opted_out']);
  });

  it('caps the history at 20 entries, newest first', async () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ status: 'opted_out' as const, source: 'manual' as const, at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` }));
    const { repo } = makeRepo([stored({ history }), {}]);
    const row = await repo.setStatus({ channel: 'sms', address: '+14045551234', status: 'opted_in', source: 'manual', by: 'u1', at: T1 });
    expect(row.history).toHaveLength(20);
    expect(row.history[0]).toEqual({ status: 'opted_in', source: 'manual', at: T1, by: 'u1' });
  });

  it('re-reads and retries when a concurrent write beat it', async () => {
    const { repo, sent } = makeRepo([stored(), conditionalCheckFailed(), stored({ updatedAt: T1 }), {}]);
    await repo.setStatus({ channel: 'sms', address: '+14045551234', status: 'opted_in', source: 'manual', at: '2026-09-15T11:00:00.000Z' });
    expect(sent.map((s) => s.name)).toEqual(['GetCommand', 'PutCommand', 'GetCommand', 'PutCommand']);
    expect(sent[3].input.ExpressionAttributeValues).toEqual({ ':expected': T1 });
  });

  it('put and remove address the same key', async () => {
    const { repo, sent } = makeRepo();
    await repo.put(createMockOptOut({ channel: 'email', address: 'a@b.co' }));
    await repo.remove('email', 'a@b.co');
    expect(sent[0].input.Item).toMatchObject({ PK: 'OPTOUT#email#a@b.co', SK: 'METADATA' });
    expect(sent[0].input.ConditionExpression).toBeUndefined();
    expect(sent[1].name).toBe('DeleteCommand');
    expect(sent[1].input.Key).toEqual({ PK: 'OPTOUT#email#a@b.co', SK: 'METADATA' });
  });
});
