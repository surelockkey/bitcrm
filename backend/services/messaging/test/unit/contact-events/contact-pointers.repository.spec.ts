import { ContactPointersRepository } from '../../../src/contact-events/contact-pointers.repository';
import { conditionalCheckFailed, mockDynamo, T0 } from '../mocks';

describe('ContactPointersRepository', () => {
  it('puts CONVOF#contact#<id> guarded by "absent or already this conversation"', async () => {
    const { dynamo, sent } = mockDynamo();
    const repo = new ContactPointersRepository(dynamo);
    expect(await repo.putPartyPointer('contact', 'keep', 'c1', T0)).toBe(true);
    expect(sent[0].name).toBe('PutCommand');
    expect(sent[0].input).toMatchObject({
      Item: { PK: 'CONVOF#contact#keep', SK: 'METADATA', pointerKind: 'contact', pointerId: 'keep', conversationId: 'c1', createdAt: T0 },
      ConditionExpression: 'attribute_not_exists(PK) OR conversationId = :cid',
      ExpressionAttributeValues: { ':cid': 'c1' },
    });
  });

  it('answers false when another conversation owns the pointer', async () => {
    const { dynamo } = mockDynamo([conditionalCheckFailed()]);
    const repo = new ContactPointersRepository(dynamo);
    expect(await repo.putPartyPointer('contact', 'keep', 'c1', T0)).toBe(false);
  });

  it('deletes the old key only while it still points at the expected conversation', async () => {
    const { dynamo, sent } = mockDynamo([{}, conditionalCheckFailed()]);
    const repo = new ContactPointersRepository(dynamo);
    expect(await repo.removePartyPointer('contact', 'dup', 'c1')).toBe(true);
    expect(sent[0].name).toBe('DeleteCommand');
    expect(sent[0].input).toMatchObject({
      Key: { PK: 'CONVOF#contact#dup', SK: 'METADATA' },
      ConditionExpression: 'conversationId = :cid',
      ExpressionAttributeValues: { ':cid': 'c1' },
    });
    expect(await repo.removePartyPointer('contact', 'dup', 'c1')).toBe(false);
  });

  it('rethrows anything that is not a conditional failure', async () => {
    const { dynamo } = mockDynamo([new Error('throttled')]);
    const repo = new ContactPointersRepository(dynamo);
    await expect(repo.removePartyPointer('contact', 'dup', 'c1')).rejects.toThrow('throttled');
  });
});
