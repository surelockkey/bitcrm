import { EmailMessagesRepository } from '../../../src/email/email-messages.repository';
import { T1, conditionalCheckFailed, mockDynamo } from '../mocks';

const key = { conversationId: 'c1', createdAt: T1, messageId: 'm2' };
const AT = '2026-09-15T10:05:02.000Z';

describe('EmailMessagesRepository.attachSesMessageId', () => {
  it('records the SES id as providerSid and emailMessageId without touching the status', async () => {
    const { dynamo, sent } = mockDynamo();
    const repo = new EmailMessagesRepository(dynamo);
    expect(await repo.attachSesMessageId(key, { providerSid: 'ses-1', emailMessageId: '<ses-1@email.amazonses.com>', at: AT })).toBe(true);
    expect(sent[0].name).toBe('UpdateCommand');
    expect(sent[0].input).toEqual({
      TableName: 'BitCRM_Messaging',
      Key: { PK: 'CONV#c1', SK: `MSG#${T1}#m2` },
      UpdateExpression: 'SET #providerSid = :sid, #emailMessageId = :emailMessageId, #updatedAt = :at',
      ConditionExpression: 'attribute_exists(PK) AND (attribute_not_exists(#providerSid) OR #providerSid = :sid)',
      ExpressionAttributeNames: { '#providerSid': 'providerSid', '#emailMessageId': 'emailMessageId', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':sid': 'ses-1', ':emailMessageId': '<ses-1@email.amazonses.com>', ':at': AT },
    });
    expect(sent[0].input.UpdateExpression).not.toContain('status');
  });

  it('fills in from only when the message had none', async () => {
    const { dynamo, sent } = mockDynamo();
    await new EmailMessagesRepository(dynamo).attachSesMessageId(key, { providerSid: 'ses-1', emailMessageId: '<x>', from: 'office@example.com', at: AT });
    expect(sent[0].input.UpdateExpression).toBe(
      'SET #providerSid = :sid, #emailMessageId = :emailMessageId, #updatedAt = :at, #from = if_not_exists(#from, :from)',
    );
    expect(sent[0].input.ExpressionAttributeValues[':from']).toBe('office@example.com');
  });

  it('answers false when another id is already attached, rethrows anything else', async () => {
    expect(await new EmailMessagesRepository(mockDynamo([conditionalCheckFailed()]).dynamo).attachSesMessageId(key, { providerSid: 'x', emailMessageId: '<x>' })).toBe(false);
    await expect(new EmailMessagesRepository(mockDynamo([new Error('boom')]).dynamo).attachSesMessageId(key, { providerSid: 'x', emailMessageId: '<x>' })).rejects.toThrow('boom');
  });
});
