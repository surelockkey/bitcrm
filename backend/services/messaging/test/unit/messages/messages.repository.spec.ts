import {
  MessagesRepository,
  messageItem,
  messagePreview,
  rollForward,
  toMessage,
} from '../../../src/messages/messages.repository';
import { conversationItem } from '../../../src/conversations/conversation-keys';
import { StaleConversationError } from '../../../src/conversations/conversations.repository';
import { decodeCursor } from '../../../src/common/cursor';
import {
  NOW,
  T0,
  T1,
  conditionalCheckFailed,
  createMockConversation,
  createMockMessage,
  mockDynamo,
  transactionCanceled,
} from '../mocks';

function makeRepo(responses: Parameters<typeof mockDynamo>[0] = []) {
  const { dynamo, sent } = mockDynamo(responses);
  return { repo: new MessagesRepository(dynamo), sent };
}

const AT = '2026-09-15T10:05:01.000Z';

describe('message items', () => {
  it('stores under CONV#/MSG#<createdAt>#<id> with statusRank and the sparse GSIs', () => {
    const item = messageItem(createMockMessage({ dealId: 'd1', flagged: true, errorCode: '' }));
    expect(item).toMatchObject({
      PK: 'CONV#c1',
      SK: `MSG#${T1}#m1`,
      statusRank: 0,
      GSI4PK: 'JOB#d1',
      GSI4SK: `${T1}#m1`,
      GSI5PK: 'FLAG#message#2026',
      GSI5SK: `${T1}#m1`,
    });
    expect('errorCode' in item).toBe(false);

    const plain = messageItem(createMockMessage({ status: 'queued' }));
    expect(plain.GSI4PK).toBeUndefined();
    expect(plain.GSI5PK).toBeUndefined();
    expect(plain.statusRank).toBe(0);
  });

  it('reads back without key attributes or statusRank', () => {
    const m = createMockMessage({ dealId: 'd1' });
    expect(toMessage(messageItem(m))).toEqual(m);
  });

  it('previews the body, then the subject, then an attachment marker, capped at 160', () => {
    expect(messagePreview(createMockMessage({ body: '  hi  ' }))).toBe('hi');
    expect(messagePreview(createMockMessage({ body: undefined, subject: 'Invoice' }))).toBe('Invoice');
    expect(
      messagePreview(createMockMessage({ body: undefined, attachments: [{ id: 'a', fileName: 'x.jpg', contentType: 'image/jpeg', status: 'pending' }] })),
    ).toBe('[attachment]');
    expect(messagePreview(createMockMessage({ body: 'x'.repeat(500) }))).toHaveLength(160);
    expect(messagePreview(createMockMessage({ body: undefined }))).toBeUndefined();
  });

  it('rollForward advances last* for a newer message and never rewinds for an older one', () => {
    const c = createMockConversation({ lastMessageAt: T1, lastMessageId: 'm1', lastBusinessNumber: '+15550009999', unreadCount: 1 });
    const newer = rollForward(c, createMockMessage({ id: 'm2', createdAt: '2026-09-15T10:06:00.000Z', dealId: 'd1' }), AT, { markUnread: true });
    expect(newer).toMatchObject({
      lastMessageAt: '2026-09-15T10:06:00.000Z',
      lastMessageId: 'm2',
      lastBusinessNumber: '+15550001111',
      lastDealId: 'd1',
      lastDirection: 'inbound',
      unread: true,
      unreadCount: 2,
      updatedAt: AT,
    });

    const older = rollForward(c, createMockMessage({ id: 'm0', createdAt: T0 }), AT, { markUnread: false });
    expect(older).toMatchObject({ lastMessageAt: T1, lastMessageId: 'm1', unread: false, unreadCount: 1, updatedAt: AT });
  });
});

describe('MessagesRepository.appendInbound', () => {
  it('writes PSID#, the message, the conversation roll-forward and the counters in one transaction', async () => {
    const { repo, sent } = makeRepo();
    const conversation = createMockConversation();
    const message = createMockMessage({ dealId: 'd1' });
    const res = await repo.appendInbound({ message, conversation, at: AT });

    expect(res.duplicate).toBe(false);
    expect(res.conversation).toMatchObject({ unread: true, unreadCount: 1, lastMessageId: 'm1', lastDealId: 'd1', updatedAt: AT });
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('TransactWriteCommand');

    const [psid, msg, conv, counters] = sent[0].input.TransactItems;
    expect(psid.Put).toEqual({
      TableName: 'BitCRM_Messaging',
      Item: { PK: 'PSID#SM1', SK: 'METADATA', providerSid: 'SM1', conversationId: 'c1', messageSk: `MSG#${T1}#m1`, createdAt: T1 },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
    expect(msg.Put).toMatchObject({
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: { PK: 'CONV#c1', SK: `MSG#${T1}#m1`, GSI4PK: 'JOB#d1' },
    });
    expect(conv.Update.Key).toEqual({ PK: 'CONV#c1', SK: 'METADATA' });
    expect(conv.Update.ConditionExpression).toBe('attribute_exists(PK) AND #updatedAt = :expectedUpdatedAt');
    expect(conv.Update.UpdateExpression).toContain('ADD #unreadCount :unreadInc');
    expect(conv.Update.UpdateExpression).toContain('#unread = :unread');
    expect(conv.Update.ExpressionAttributeValues).toMatchObject({
      ':expectedUpdatedAt': T0,
      ':unread': true,
      ':unreadInc': 1,
      ':lastMessageAt': T1,
      ':lastMessageId': 'm1',
      ':lastMessagePreview': 'Hello',
      ':lastChannel': 'sms',
      ':lastDirection': 'inbound',
      ':lastBusinessNumber': '+15550001111',
      ':lastDealId': 'd1',
      ':GSI1PK': 'INBOX#open#2026',
      ':GSI1SK': `${T1}#c1`,
      ':GSI2PK': 'UNREAD#2026',
      ':GSI3PK': 'CAT#client#2026',
    });
    expect(counters.Update).toMatchObject({
      Key: { PK: 'INBOX#COUNTERS', SK: 'METADATA' },
      UpdateExpression: 'ADD #unread :unread, #kind_client :kind_client',
      ExpressionAttributeValues: { ':unread': 1, ':kind_client': 1 },
    });
  });

  it('skips the counters item when the conversation was already unread', async () => {
    const { repo, sent } = makeRepo();
    const res = await repo.appendInbound({
      message: createMockMessage(),
      conversation: createMockConversation({ unread: true, unreadCount: 2 }),
      at: AT,
    });
    expect(sent[0].input.TransactItems).toHaveLength(3);
    expect(res.conversation.unreadCount).toBe(3);
  });

  it('reports a duplicate webhook without writing anything else', async () => {
    const { repo, sent } = makeRepo([transactionCanceled(['ConditionalCheckFailed', 'None', 'None', 'None'])]);
    const conversation = createMockConversation();
    const res = await repo.appendInbound({ message: createMockMessage(), conversation, at: AT });
    expect(res).toEqual({ duplicate: true, conversation });
    expect(sent).toHaveLength(1);
  });

  it('re-reads the conversation and retries when the optimistic guard trips', async () => {
    const fresh = createMockConversation({ updatedAt: '2026-09-15T10:04:00.000Z', flagged: true });
    const { repo, sent } = makeRepo([
      transactionCanceled(['None', 'None', 'ConditionalCheckFailed', 'None']),
      { Item: conversationItem(fresh) },
      {},
    ]);
    const res = await repo.appendInbound({ message: createMockMessage(), conversation: createMockConversation(), at: AT });

    expect(sent.map((s) => s.name)).toEqual(['TransactWriteCommand', 'GetCommand', 'TransactWriteCommand']);
    expect(sent[1].input.Key).toEqual({ PK: 'CONV#c1', SK: 'METADATA' });
    const conv = sent[2].input.TransactItems[2].Update;
    expect(conv.ExpressionAttributeValues[':expectedUpdatedAt']).toBe('2026-09-15T10:04:00.000Z');
    // the retry is built from the fresh state: the flag set meanwhile is kept
    expect(conv.ExpressionAttributeValues[':GSI5PK']).toBe('FLAG#conversation');
    expect(res.conversation.flagged).toBe(true);
  });

  it('gives up after repeated stale guards', async () => {
    const stale = () => transactionCanceled(['None', 'None', 'ConditionalCheckFailed']);
    const item = { Item: conversationItem(createMockConversation()) };
    const { repo } = makeRepo([stale(), item, stale(), item, stale()]);
    await expect(
      repo.appendInbound({ message: createMockMessage(), conversation: createMockConversation(), at: AT }),
    ).rejects.toMatchObject({ name: 'TransactionCanceledException' });
  });

  it('refuses an inbound message without a provider sid', async () => {
    const { repo, sent } = makeRepo();
    await expect(
      repo.appendInbound({ message: createMockMessage({ providerSid: undefined }), conversation: createMockConversation() }),
    ).rejects.toThrow(/providerSid/);
    expect(sent).toHaveLength(0);
  });
});

describe('MessagesRepository.appendOutbound', () => {
  const outbound = createMockMessage({
    id: 'm2',
    direction: 'outbound',
    status: 'queued',
    from: '+15550001111',
    to: '+14045551234',
    providerSid: undefined,
    origin: 'user',
    sentByUserId: 'u1',
  });

  it('writes CLIENTMSG# (with TTL), the queued message and the roll-forward without touching unread', async () => {
    const { repo, sent } = makeRepo();
    const res = await repo.appendOutbound({
      message: outbound,
      clientMessageId: 'cm-1',
      createdBy: 'u1',
      conversation: createMockConversation({ unread: true, unreadCount: 1 }),
      at: AT,
    });

    expect(res.duplicate).toBe(false);
    expect(res.conversation).toMatchObject({ unread: true, unreadCount: 1, lastDirection: 'outbound', lastMessageId: 'm2' });
    const [cm, msg, conv] = sent[0].input.TransactItems;
    expect(sent[0].input.TransactItems).toHaveLength(3);
    expect(cm.Put).toEqual({
      TableName: 'BitCRM_Messaging',
      Item: {
        PK: 'CLIENTMSG#cm-1',
        SK: 'METADATA',
        clientMessageId: 'cm-1',
        conversationId: 'c1',
        messageSk: `MSG#${T1}#m2`,
        createdBy: 'u1',
        createdAt: AT,
        expiresAt: Math.floor(new Date(AT).getTime() / 1000) + 7 * 24 * 3600,
      },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
    expect(msg.Put.Item).toMatchObject({ PK: 'CONV#c1', SK: `MSG#${T1}#m2`, status: 'queued', statusRank: 0 });
    expect(conv.Update.UpdateExpression).not.toContain('ADD');
    expect(conv.Update.UpdateExpression).not.toContain('#unread = :unread');
    expect(conv.Update.ExpressionAttributeValues[':lastDirection']).toBe('outbound');
  });

  it('returns the first submit on a repeated clientMessageId', async () => {
    const pointer = { PK: 'CLIENTMSG#cm-1', SK: 'METADATA', clientMessageId: 'cm-1', conversationId: 'c1', messageSk: `MSG#${T1}#m2`, createdBy: 'u1', createdAt: AT, expiresAt: 1 };
    const { repo, sent } = makeRepo([transactionCanceled(['ConditionalCheckFailed', 'None', 'None']), { Item: pointer }]);
    const conversation = createMockConversation();
    const res = await repo.appendOutbound({ message: outbound, clientMessageId: 'cm-1', createdBy: 'u1', conversation, at: AT });

    expect(res.duplicate).toBe(true);
    expect(res.conversation).toBe(conversation);
    expect(res.existing).toMatchObject({ clientMessageId: 'cm-1', messageSk: `MSG#${T1}#m2` });
    expect(sent[1].input.Key).toEqual({ PK: 'CLIENTMSG#cm-1', SK: 'METADATA' });
  });

  it('retries from a fresh read on a stale guard and raises StaleConversationError when it never settles', async () => {
    const stale = () => transactionCanceled(['None', 'None', 'ConditionalCheckFailed']);
    const item = { Item: conversationItem(createMockConversation()) };
    const { repo, sent } = makeRepo([stale(), item, {}]);
    const ok = await repo.appendOutbound({ message: outbound, clientMessageId: 'cm-1', createdBy: 'u1', conversation: createMockConversation(), at: AT });
    expect(ok.duplicate).toBe(false);
    expect(sent.map((s) => s.name)).toEqual(['TransactWriteCommand', 'GetCommand', 'TransactWriteCommand']);

    const { repo: never } = makeRepo([stale(), item, stale(), item, stale()]);
    await expect(
      never.appendOutbound({ message: outbound, clientMessageId: 'cm-1', createdBy: 'u1', conversation: createMockConversation(), at: AT }),
    ).rejects.toMatchObject({ name: 'TransactionCanceledException' });
    expect(StaleConversationError).toBeDefined();
  });
});

describe('MessagesRepository.updateStatus', () => {
  const key = { conversationId: 'c1', createdAt: T1, messageId: 'm1' };

  it('applies a status with the rank and provider-sid guards', async () => {
    const { repo, sent } = makeRepo();
    const applied = await repo.updateStatus(key, { status: 'delivered', providerSid: 'SM1', at: AT });

    expect(applied).toBe(true);
    const input = sent[0].input;
    expect(sent[0].name).toBe('UpdateCommand');
    expect(input.Key).toEqual({ PK: 'CONV#c1', SK: `MSG#${T1}#m1` });
    expect(input.ConditionExpression).toBe(
      'attribute_exists(PK) AND (attribute_not_exists(#statusRank) OR #statusRank < :rank) AND (attribute_not_exists(#providerSid) OR #providerSid = :providerSid)',
    );
    expect(input.UpdateExpression).toBe(
      'SET #status = :status, #statusRank = :rank, #updatedAt = :at, #providerSid = :providerSid, #deliveredAt = :deliveredAt',
    );
    expect(input.ExpressionAttributeValues).toEqual({
      ':status': 'delivered',
      ':rank': 3,
      ':at': AT,
      ':providerSid': 'SM1',
      ':deliveredAt': AT,
    });
  });

  it('records failure codes and stamps sentAt for sent', async () => {
    const { repo, sent } = makeRepo([{}, {}]);
    await repo.updateStatus(key, { status: 'failed', errorCode: '21610', errorMessage: 'Unsubscribed recipient', at: AT });
    expect(sent[0].input.ExpressionAttributeValues).toMatchObject({ ':errorCode': '21610', ':errorMessage': 'Unsubscribed recipient', ':rank': 3 });
    expect(sent[0].input.ConditionExpression).not.toContain('providerSid');

    await repo.updateStatus(key, { status: 'sent', at: AT, segments: 2 });
    expect(sent[1].input.ExpressionAttributeValues).toMatchObject({ ':sentAt': AT, ':segments': 2, ':rank': 2 });
  });

  it('returns false when the rank guard rejects an out-of-order callback', async () => {
    const { repo } = makeRepo([conditionalCheckFailed()]);
    expect(await repo.updateStatus(key, { status: 'sent' })).toBe(false);
  });
});

describe('MessagesRepository.markSending', () => {
  it('claims a queued message exactly once', async () => {
    const { repo, sent } = makeRepo([{}, conditionalCheckFailed()]);
    const key = { conversationId: 'c1', createdAt: T1, messageId: 'm1' };
    expect(await repo.markSending(key, AT)).toBe(true);
    expect(sent[0].input.ConditionExpression).toBe(
      'attribute_exists(PK) AND #status = :queued AND attribute_not_exists(#providerSid) AND attribute_not_exists(#sendingStartedAt)',
    );
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':sending': 'sending', ':queued': 'queued', ':rank': 1, ':at': AT });
    expect(await repo.markSending(key, AT)).toBe(false);
  });
});

describe('MessagesRepository.setFlagged', () => {
  const key = { conversationId: 'c1', createdAt: T1, messageId: 'm1' };

  it('sets the FLAG#message#<year> index keys when flagging', async () => {
    const { repo, sent } = makeRepo();
    await repo.setFlagged(key, true, 'u1', AT);
    expect(sent[0].input.UpdateExpression).toBe(
      'SET #flagged = :flagged, #flaggedAt = :at, #flaggedBy = :by, #updatedAt = :at, #GSI5PK = :gsi5pk, #GSI5SK = :gsi5sk',
    );
    expect(sent[0].input.ExpressionAttributeValues).toEqual({
      ':flagged': true,
      ':at': AT,
      ':by': 'u1',
      ':gsi5pk': 'FLAG#message#2026',
      ':gsi5sk': `${T1}#m1`,
    });
  });

  it('REMOVEs them when unflagging', async () => {
    const { repo, sent } = makeRepo();
    await repo.setFlagged(key, false, 'u1', AT);
    expect(sent[0].input.UpdateExpression).toBe(
      'SET #flagged = :flagged, #updatedAt = :at REMOVE #flaggedAt, #flaggedBy, #GSI5PK, #GSI5SK',
    );
    expect(sent[0].input.ConditionExpression).toBe('attribute_exists(PK)');
  });
});

describe('MessagesRepository.markResent', () => {
  it('points the failed line at its replacement without touching status or rank; the line must exist', async () => {
    const { repo, sent } = makeRepo();
    await repo.markResent({ conversationId: 'c1', createdAt: T1, messageId: 'm1' }, 'm-new', AT);
    expect(sent).toHaveLength(1);
    expect(sent[0].name).toBe('UpdateCommand');
    expect(sent[0].input).toMatchObject({
      Key: { PK: 'CONV#c1', SK: `MSG#${T1}#m1` },
      UpdateExpression: 'SET #resentAsMessageId = :resentAsMessageId, #updatedAt = :at',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeNames: { '#resentAsMessageId': 'resentAsMessageId', '#updatedAt': 'updatedAt' },
      ExpressionAttributeValues: { ':resentAsMessageId': 'm-new', ':at': AT },
    });
    expect(sent[0].input.UpdateExpression).not.toMatch(/status/);
  });
});

describe('MessagesRepository pointers', () => {
  it('putProviderSidPointer is first-writer-wins', async () => {
    const { repo, sent } = makeRepo([{}, conditionalCheckFailed()]);
    const key = { conversationId: 'c1', createdAt: T1, messageId: 'm2' };
    expect(await repo.putProviderSidPointer('SM2', key, AT)).toBe(true);
    expect(sent[0].input).toMatchObject({
      ConditionExpression: 'attribute_not_exists(PK)',
      Item: { PK: 'PSID#SM2', SK: 'METADATA', providerSid: 'SM2', conversationId: 'c1', messageSk: `MSG#${T1}#m2`, createdAt: AT },
    });
    expect(await repo.putProviderSidPointer('SM2', key, AT)).toBe(false);
  });

  it('getByProviderSid follows PSID# to the message', async () => {
    const m = createMockMessage();
    const { repo, sent } = makeRepo([
      { Item: { PK: 'PSID#SM1', SK: 'METADATA', providerSid: 'SM1', conversationId: 'c1', messageSk: `MSG#${T1}#m1`, createdAt: T1 } },
      { Item: messageItem(m) },
    ]);
    expect(await repo.getByProviderSid('SM1')).toEqual(m);
    expect(sent[0].input.Key).toEqual({ PK: 'PSID#SM1', SK: 'METADATA' });
    expect(sent[1].input.Key).toEqual({ PK: 'CONV#c1', SK: `MSG#${T1}#m1` });
  });

  it('getByProviderSid / getClientMessagePointer / get answer null on a miss', async () => {
    const { repo } = makeRepo([{}, {}, {}]);
    expect(await repo.getByProviderSid('SMx')).toBeNull();
    expect(await repo.getClientMessagePointer('cm-x')).toBeNull();
    expect(await repo.get({ conversationId: 'c1', createdAt: T1, messageId: 'mx' })).toBeNull();
  });
});

describe('MessagesRepository listings', () => {
  it('pages the feed newest-first inside the conversation partition', async () => {
    const lek = { PK: 'CONV#c1', SK: `MSG#${T0}#m0` };
    const { repo, sent } = makeRepo([{ Items: [messageItem(createMockMessage())], LastEvaluatedKey: lek }, { Items: [] }]);
    const page = await repo.listByConversation('c1', { limit: 50 });

    expect(page.items).toEqual([createMockMessage()]);
    expect(sent[0].input).toMatchObject({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': 'CONV#c1', ':prefix': 'MSG#' },
      ScanIndexForward: false,
      Limit: 50,
    });
    expect(sent[0].input.IndexName).toBeUndefined();
    expect(decodeCursor(page.nextCursor)).toEqual({ k: lek });

    await repo.listByConversation('c1', { limit: 50, cursor: page.nextCursor });
    expect(sent[1].input.ExclusiveStartKey).toEqual(lek);
  });

  it('lists a job’s messages from JobIndex', async () => {
    const { repo, sent } = makeRepo([{ Items: [] }]);
    await repo.listByJob('d1', { limit: 20 });
    expect(sent[0].input).toMatchObject({
      IndexName: 'JobIndex',
      KeyConditionExpression: 'GSI4PK = :pk',
      ExpressionAttributeValues: { ':pk': 'JOB#d1' },
      ScanIndexForward: false,
      Limit: 20,
    });
  });

  it('lists flagged messages year by year on FlagIndex', async () => {
    const { repo, sent } = makeRepo([{ Items: [messageItem(createMockMessage({ flagged: true }))] }, { Items: [] }]);
    const page = await repo.listFlagged({ limit: 2, now: NOW });
    expect(page.items).toHaveLength(1);
    expect(sent[0].input).toMatchObject({ IndexName: 'FlagIndex', ExpressionAttributeValues: { ':pk': 'FLAG#message#2026' } });
    expect(sent[1].input.ExpressionAttributeValues[':pk']).toBe('FLAG#message#2025');
  });
});
