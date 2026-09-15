import { MessagesRepository, messageItem } from '../../../src/messages/messages.repository';
import { T1, conditionalCheckFailed, createMockMessage, mockDynamo } from '../mocks';

const AT = '2026-09-15T10:05:01.000Z';
const key = { conversationId: 'c1', createdAt: T1, messageId: 'm1' };

const withAttachments = () =>
  createMockMessage({
    attachments: [
      { id: 'a0', fileName: 'ME0.jpg', contentType: 'image/jpeg', status: 'stored', s3Key: 'messaging/c1/m1/a0' },
      { id: 'a1', fileName: 'ME1.png', contentType: 'image/png', status: 'pending', sourceUrl: 'https://t/1' },
    ],
  });

function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new MessagesRepository(dynamo), sent };
}

describe('MessagesRepository.updateAttachment', () => {
  it('reads the message, then rewrites only the matching attachments[i] fields, guarded by its id', async () => {
    const { repo, sent } = makeRepo([{ Item: messageItem(withAttachments()) }, {}]);
    const applied = await repo.updateAttachment(key, 'a1', { status: 'stored', s3Key: 'messaging/c1/m1/a1', size: 1234, contentType: 'image/png' }, AT);

    expect(applied).toBe(true);
    expect(sent.map((s) => s.name)).toEqual(['GetCommand', 'UpdateCommand']);
    expect(sent[0].input.Key).toEqual({ PK: 'CONV#c1', SK: `MSG#${T1}#m1` });
    const update = sent[1].input;
    expect(update.Key).toEqual({ PK: 'CONV#c1', SK: `MSG#${T1}#m1` });
    expect(update.UpdateExpression).toBe(
      'SET #updatedAt = :at, #attachments[1].#status = :status, #attachments[1].#s3Key = :s3Key, #attachments[1].#size = :size, #attachments[1].#contentType = :contentType',
    );
    expect(update.ConditionExpression).toBe('attribute_exists(PK) AND #attachments[1].#id = :attachmentId');
    expect(update.ExpressionAttributeNames).toEqual({
      '#attachments': 'attachments',
      '#id': 'id',
      '#updatedAt': 'updatedAt',
      '#status': 'status',
      '#s3Key': 's3Key',
      '#size': 'size',
      '#contentType': 'contentType',
    });
    expect(update.ExpressionAttributeValues).toEqual({
      ':attachmentId': 'a1',
      ':at': AT,
      ':status': 'stored',
      ':s3Key': 'messaging/c1/m1/a1',
      ':size': 1234,
      ':contentType': 'image/png',
    });
  });

  it('skips empty patch values', async () => {
    const { repo, sent } = makeRepo([{ Item: messageItem(withAttachments()) }, {}]);
    await repo.updateAttachment(key, 'a0', { status: 'failed', s3Key: undefined, size: undefined }, AT);
    expect(sent[1].input.UpdateExpression).toBe('SET #updatedAt = :at, #attachments[0].#status = :status');
  });

  it('answers false without writing when the message or the attachment is not there', async () => {
    const missingMessage = makeRepo([{}]);
    expect(await missingMessage.repo.updateAttachment(key, 'a1', { status: 'stored' })).toBe(false);
    expect(missingMessage.sent).toHaveLength(1);

    const missingAttachment = makeRepo([{ Item: messageItem(withAttachments()) }]);
    expect(await missingAttachment.repo.updateAttachment(key, 'nope', { status: 'stored' })).toBe(false);
    expect(missingAttachment.sent).toHaveLength(1);

    const noAttachments = makeRepo([{ Item: messageItem(createMockMessage()) }]);
    expect(await noAttachments.repo.updateAttachment(key, 'a1', { status: 'stored' })).toBe(false);
  });

  it('answers false when the list changed underneath (id guard), rethrows anything else', async () => {
    const raced = makeRepo([{ Item: messageItem(withAttachments()) }, conditionalCheckFailed()]);
    expect(await raced.repo.updateAttachment(key, 'a1', { status: 'stored' })).toBe(false);

    const broken = makeRepo([{ Item: messageItem(withAttachments()) }, new Error('boom')]);
    await expect(broken.repo.updateAttachment(key, 'a1', { status: 'stored' })).rejects.toThrow('boom');
  });
});
