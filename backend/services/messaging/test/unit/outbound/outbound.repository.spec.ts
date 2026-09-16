import { OutboundRepository } from '../../../src/outbound/outbound.repository';
import { T1, conditionalCheckFailed, mockDynamo } from '../mocks';

const key = { conversationId: 'c1', createdAt: T1, messageId: 'm2' };
const AT = '2026-09-15T10:05:02.000Z';

describe('OutboundRepository.attachProviderSid', () => {
  it('records the sid and segments without touching the status, guarded by sid absent-or-equal', async () => {
    const { dynamo, sent } = mockDynamo();
    const repo = new OutboundRepository(dynamo);
    expect(await repo.attachProviderSid(key, { providerSid: 'SM2', segments: 2, at: AT })).toBe(true);

    expect(sent[0].name).toBe('UpdateCommand');
    expect(sent[0].input).toEqual({
      TableName: 'BitCRM_Messaging',
      Key: { PK: 'CONV#c1', SK: `MSG#${T1}#m2` },
      UpdateExpression: 'SET #providerSid = :sid, #updatedAt = :at, #segments = :segments',
      ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#providerSid) OR #providerSid = :sid)',
      ExpressionAttributeNames: { '#providerSid': 'providerSid', '#updatedAt': 'updatedAt', '#segments': 'segments' },
      ExpressionAttributeValues: { ':sid': 'SM2', ':at': AT, ':segments': 2 },
    });
    expect(sent[0].input.UpdateExpression).not.toContain('status');
  });

  it('fills in from/businessNumber only when the message had none (pool sends)', async () => {
    const { dynamo, sent } = mockDynamo();
    const repo = new OutboundRepository(dynamo);
    await repo.attachProviderSid(key, { providerSid: 'SM2', from: '+15550002222', at: AT });
    expect(sent[0].input.UpdateExpression).toBe(
      'SET #providerSid = :sid, #updatedAt = :at, #from = if_not_exists(#from, :from), #businessNumber = if_not_exists(#businessNumber, :from)',
    );
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':sid': 'SM2', ':at': AT, ':from': '+15550002222' });
  });

  it('answers false when another sid is already attached', async () => {
    const { dynamo } = mockDynamo([conditionalCheckFailed()]);
    expect(await new OutboundRepository(dynamo).attachProviderSid(key, { providerSid: 'SM9' })).toBe(false);
  });

  it('rethrows anything that is not a conditional failure', async () => {
    const { dynamo } = mockDynamo([new Error('ProvisionedThroughputExceeded')]);
    await expect(new OutboundRepository(dynamo).attachProviderSid(key, { providerSid: 'SM9' })).rejects.toThrow('ProvisionedThroughputExceeded');
  });
});
