import { TechScopeRepository } from '../../../src/tech-scope/tech-scope.repository';
import { conditionalCheckFailed, mockDynamo } from '../mocks';

describe('TechScopeRepository — key shapes and guards', () => {
  const row = {
    userId: 'tech-1',
    deals: [{ id: 'd1', contactId: 'ct1' }, { id: 'd2', contactId: 'ct1', companyId: 'co1' }],
    computedAt: '2026-10-13T12:00:00.000Z',
    dealCount: 2,
  };

  it('get reads TECHSCOPE / USER#<id>', async () => {
    const { dynamo, sent } = mockDynamo([{ Item: { PK: 'TECHSCOPE', SK: 'USER#tech-1', ...row, contactIds: ['ct1'] } }]);
    expect(await new TechScopeRepository(dynamo).get('tech-1')).toEqual(row);
    expect(sent[0].input.Key).toEqual({ PK: 'TECHSCOPE', SK: 'USER#tech-1' });
  });

  it('put stores the flat contactIds a merge filters on, guarded so an older computation never wins', async () => {
    const { dynamo, sent } = mockDynamo();
    expect(await new TechScopeRepository(dynamo).put(row)).toBe(true);
    expect(sent[0].input.Item).toMatchObject({ PK: 'TECHSCOPE', SK: 'USER#tech-1', contactIds: ['ct1'], dealCount: 2 });
    expect(sent[0].input.ConditionExpression).toBe('attribute_not_exists(PK) OR computedAt <= :at');
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':at': row.computedAt });
  });

  it('put answers false when the guard refuses; a merge rewrite demands the row it read', async () => {
    const { dynamo, sent } = mockDynamo([conditionalCheckFailed()]);
    const repo = new TechScopeRepository(dynamo);
    expect(await repo.put(row, { expectComputedAt: 'prev' })).toBe(false);
    expect(sent[0].input.ConditionExpression).toBe('computedAt = :prev');
  });

  it('listByContact walks the one partition with a contains filter', async () => {
    const { dynamo, sent } = mockDynamo([{ Items: [], LastEvaluatedKey: { PK: 'TECHSCOPE', SK: 'USER#a' } }, { Items: [] }]);
    await new TechScopeRepository(dynamo).listByContact('ct1');
    expect(sent).toHaveLength(2);
    expect(sent[0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      FilterExpression: 'contains(contactIds, :c)',
      ExpressionAttributeValues: { ':pk': 'TECHSCOPE', ':sk': 'USER#', ':c': 'ct1' },
    });
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'TECHSCOPE', SK: 'USER#a' });
  });

  it('the gate lives at TECHSCOPEINDEX / STATE', async () => {
    const { dynamo, sent } = mockDynamo([{}, {}]);
    const repo = new TechScopeRepository(dynamo);
    expect(await repo.getState()).toBeNull();
    await repo.putState({ readyAt: 'r', count: 3 });
    expect(sent[0].input.Key).toEqual({ PK: 'TECHSCOPEINDEX', SK: 'STATE' });
    expect(sent[1].input.Item).toMatchObject({ PK: 'TECHSCOPEINDEX', SK: 'STATE', readyAt: 'r', count: 3 });
  });
});
