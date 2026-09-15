import { MessageTemplatesRepository } from '../../../src/templates/message-templates.repository';
import { T1, createMockTemplate, mockDynamo } from '../mocks';

function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new MessageTemplatesRepository(dynamo), sent };
}

const stored = (overrides = {}) => {
  const t = createMockTemplate(overrides);
  return { PK: `TEMPLATE#${t.id}`, SK: 'METADATA', GSI3PK: 'CATALOG#MESSAGE_TEMPLATE', GSI3SK: `${t.messageTemplateTitle.toLowerCase()}#${t.id}`, ...t };
};

describe('MessageTemplatesRepository', () => {
  it('creates under TEMPLATE#<id> in the CATALOG#MESSAGE_TEMPLATE partition of GSI3', async () => {
    const { repo, sent } = makeRepo();
    await repo.create(createMockTemplate({ messageSubjectTemplate: '' }));

    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input.ConditionExpression).toBe('attribute_not_exists(PK)');
    expect(sent[0].input.Item).toMatchObject({
      PK: 'TEMPLATE#t1',
      SK: 'METADATA',
      GSI3PK: 'CATALOG#MESSAGE_TEMPLATE',
      GSI3SK: 'on my way#t1',
      messageTemplateTitle: 'On My Way',
    });
    expect('messageSubjectTemplate' in sent[0].input.Item).toBe(false);
  });

  it('lists the catalog alphabetically from CategoryIndex and hides archived rows', async () => {
    const { repo, sent } = makeRepo([
      { Items: [stored({ id: 't2', messageTemplateTitle: 'Late', active: false }), stored()] },
    ]);
    const list = await repo.list();

    expect(sent[0].name).toBe('QueryCommand');
    expect(sent[0].input).toMatchObject({
      IndexName: 'CategoryIndex',
      KeyConditionExpression: 'GSI3PK = :pk',
      ExpressionAttributeValues: { ':pk': 'CATALOG#MESSAGE_TEMPLATE' },
      ScanIndexForward: true,
    });
    expect(sent[0].input.FilterExpression).toBeUndefined();
    expect(list.map((t) => t.id)).toEqual(['t1']);
    expect('PK' in list[0]).toBe(false);
  });

  it('includes archived rows on request and follows LastEvaluatedKey', async () => {
    const { repo, sent } = makeRepo([
      { Items: [stored({ id: 't2', active: false })], LastEvaluatedKey: { PK: 'TEMPLATE#t2' } },
      { Items: [stored()] },
    ]);
    const list = await repo.list({ includeInactive: true });
    expect(list.map((t) => t.id)).toEqual(['t2', 't1']);
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'TEMPLATE#t2' });
  });

  it('get / archive / remove address TEMPLATE#<id>', async () => {
    const { repo, sent } = makeRepo([{ Item: stored() }, {}, {}]);
    expect(await repo.get('t1')).toEqual(createMockTemplate());
    await repo.archive('t1', T1);
    await repo.remove('t1');

    expect(sent[0].input.Key).toEqual({ PK: 'TEMPLATE#t1', SK: 'METADATA' });
    expect(sent[1].name).toBe('UpdateCommand');
    expect(sent[1].input).toMatchObject({
      UpdateExpression: 'SET #active = :false, #updatedAt = :at',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':false': false, ':at': T1 },
    });
    expect(sent[2].name).toBe('DeleteCommand');
  });
});
