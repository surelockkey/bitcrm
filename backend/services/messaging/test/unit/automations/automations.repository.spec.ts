import { type AutomationRule } from '@bitcrm/types';
import { AutomationsRepository } from '../../../src/automations/automations.repository';
import { mockDynamo, T0 } from '../mocks';

const rule = (overrides: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'r1',
  name: 'Canceled job & techs',
  enabled: false,
  category: 'job',
  entities: ['job'],
  notifyMedium: 'sms',
  source: 'workiz',
  externalId: 'workiz:automation:619585cd235c17000843d4e1',
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

describe('AutomationsRepository', () => {
  it('gets AUTOMATION#<id>/METADATA and strips the key attributes', async () => {
    const { dynamo, sent } = mockDynamo([
      { Item: { PK: 'AUTOMATION#r1', SK: 'METADATA', GSI3PK: 'CATALOG#AUTOMATION', GSI3SK: 'canceled job & techs#r1', ...rule() } },
      {},
    ]);
    const repo = new AutomationsRepository(dynamo);
    expect(await repo.get('r1')).toEqual(rule());
    expect(sent[0]).toMatchObject({ name: 'GetCommand', input: { Key: { PK: 'AUTOMATION#r1', SK: 'METADATA' } } });
    expect(await repo.get('nope')).toBeNull();
  });

  it('lists through the GSI3 catalog partition, following every page', async () => {
    const { dynamo, sent } = mockDynamo([
      { Items: [{ PK: 'AUTOMATION#r1', SK: 'METADATA', ...rule() }], LastEvaluatedKey: { PK: 'AUTOMATION#r1' } },
      { Items: [{ PK: 'AUTOMATION#r2', SK: 'METADATA', ...rule({ id: 'r2', name: 'Deposit paid', enabled: 'yes' as never }) }] },
    ]);
    const repo = new AutomationsRepository(dynamo);
    const rules = await repo.list();
    expect(rules.map((r) => r.id)).toEqual(['r1', 'r2']);
    // anything but a boolean true reads as disabled
    expect(rules[1].enabled).toBe(false);
    expect(sent[0]).toMatchObject({
      name: 'QueryCommand',
      input: { IndexName: 'CategoryIndex', KeyConditionExpression: 'GSI3PK = :pk', ExpressionAttributeValues: { ':pk': 'CATALOG#AUTOMATION' } },
    });
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'AUTOMATION#r1' });
  });

  it('puts the whole document with the catalog keys and no empty attributes', async () => {
    const { dynamo, sent } = mockDynamo();
    const repo = new AutomationsRepository(dynamo);
    await repo.put(rule({ id: 'new-job-sms', name: ' New job SMS ', enabled: true, builtin: true, description: '' }));
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.Item).toMatchObject({
      PK: 'AUTOMATION#new-job-sms',
      SK: 'METADATA',
      GSI3PK: 'CATALOG#AUTOMATION',
      GSI3SK: 'new job sms#new-job-sms',
      enabled: true,
      builtin: true,
    });
    expect(sent[0].input.Item).not.toHaveProperty('description');
  });
});
