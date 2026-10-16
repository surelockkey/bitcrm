import { PushRepository } from '../../../src/push/push.repository';
import { conditionalCheckFailed, mockDynamo, transactionCanceled } from '../mocks';

const TOKEN = 'ExponentPushToken[abc123]';
const AT = '2026-10-16T10:00:00.000Z';
const LATER = '2026-10-16T11:00:00.000Z';

/**
 * A device token has exactly one owner (`PUSHTOKEN#<token>`), and each user
 * lists their devices under `PUSHUSER#<userId>`. The two rows move together,
 * so signing in on a shared van phone hands the token to the new user and
 * the previous one stops getting that phone's notifications.
 */
describe('PushRepository — device tokens', () => {
  it('registers a new token: the owner row (only if nobody holds it) and the user row, in one transaction', async () => {
    const { dynamo, sent } = mockDynamo([{}, {}]);
    await new PushRepository(dynamo).register('u1', TOKEN, 'ios', AT);

    expect(sent[0]).toMatchObject({ name: 'GetCommand', input: { Key: { PK: `PUSHTOKEN#${TOKEN}`, SK: 'METADATA' } } });
    expect(sent[1].name).toBe('TransactWriteCommand');
    const items = sent[1].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Put).toMatchObject({
      Item: { PK: `PUSHTOKEN#${TOKEN}`, SK: 'METADATA', token: TOKEN, userId: 'u1', platform: 'ios', createdAt: AT, updatedAt: AT },
      ConditionExpression: 'attribute_not_exists(PK)',
    });
    expect(items[1].Put).toMatchObject({
      Item: { PK: 'PUSHUSER#u1', SK: `TOKEN#${TOKEN}`, token: TOKEN, userId: 'u1', platform: 'ios', createdAt: AT, updatedAt: AT },
    });
  });

  it('re-registering their own token refreshes it and keeps when it was first seen', async () => {
    const { dynamo, sent } = mockDynamo([
      { Item: { PK: `PUSHTOKEN#${TOKEN}`, SK: 'METADATA', token: TOKEN, userId: 'u1', platform: 'ios', createdAt: AT, updatedAt: AT } },
      {},
    ]);
    await new PushRepository(dynamo).register('u1', TOKEN, 'android', LATER);

    const items = sent[1].input.TransactItems;
    expect(items).toHaveLength(2);
    expect(items[0].Put).toMatchObject({
      Item: { userId: 'u1', platform: 'android', createdAt: AT, updatedAt: LATER },
      ConditionExpression: 'userId = :prev',
      ExpressionAttributeValues: { ':prev': 'u1' },
    });
    expect(items[1].Put.Item).toMatchObject({ PK: 'PUSHUSER#u1', createdAt: AT, updatedAt: LATER });
  });

  it("moves a token another user held (shared van phone): new owner, new user row, the old user's row deleted", async () => {
    const { dynamo, sent } = mockDynamo([
      { Item: { PK: `PUSHTOKEN#${TOKEN}`, SK: 'METADATA', token: TOKEN, userId: 'u-old', platform: 'android', createdAt: AT, updatedAt: AT } },
      {},
    ]);
    await new PushRepository(dynamo).register('u-new', TOKEN, 'android', LATER);

    const items = sent[1].input.TransactItems;
    expect(items).toHaveLength(3);
    expect(items[0].Put).toMatchObject({
      Item: { PK: `PUSHTOKEN#${TOKEN}`, userId: 'u-new', createdAt: LATER, updatedAt: LATER },
      ConditionExpression: 'userId = :prev',
      ExpressionAttributeValues: { ':prev': 'u-old' },
    });
    expect(items[1].Put.Item).toMatchObject({ PK: 'PUSHUSER#u-new', SK: `TOKEN#${TOKEN}` });
    expect(items[2].Delete).toMatchObject({ Key: { PK: 'PUSHUSER#u-old', SK: `TOKEN#${TOKEN}` } });
  });

  it('re-reads and retries when another sign-in took the token in between', async () => {
    const { dynamo, sent } = mockDynamo([
      {},
      transactionCanceled(['ConditionalCheckFailed', 'None']),
      { Item: { PK: `PUSHTOKEN#${TOKEN}`, SK: 'METADATA', token: TOKEN, userId: 'u2', platform: 'ios', createdAt: AT, updatedAt: AT } },
      {},
    ]);
    await new PushRepository(dynamo).register('u1', TOKEN, 'ios', LATER);

    expect(sent.map((c) => c.name)).toEqual(['GetCommand', 'TransactWriteCommand', 'GetCommand', 'TransactWriteCommand']);
    expect(sent[3].input.TransactItems[2].Delete.Key).toEqual({ PK: 'PUSHUSER#u2', SK: `TOKEN#${TOKEN}` });
  });

  it('rethrows a transaction cancelled for anything but its guard', async () => {
    const { dynamo } = mockDynamo([{}, transactionCanceled(['ThrottlingError', 'None'])]);
    await expect(new PushRepository(dynamo).register('u1', TOKEN, 'ios', AT)).rejects.toThrow();
  });

  it('unregisters only the caller\'s own token: the owner row under a condition, then their user row', async () => {
    const { dynamo, sent } = mockDynamo([{}, {}]);
    await new PushRepository(dynamo).unregister('u1', TOKEN);

    expect(sent[0]).toMatchObject({
      name: 'DeleteCommand',
      input: {
        Key: { PK: `PUSHTOKEN#${TOKEN}`, SK: 'METADATA' },
        ConditionExpression: 'userId = :me',
        ExpressionAttributeValues: { ':me': 'u1' },
      },
    });
    expect(sent[1]).toMatchObject({ name: 'DeleteCommand', input: { Key: { PK: 'PUSHUSER#u1', SK: `TOKEN#${TOKEN}` } } });
  });

  it("a token someone else now holds (or nobody does) is left alone — still answers, and clears the caller's stale row", async () => {
    const { dynamo, sent } = mockDynamo([conditionalCheckFailed(), {}]);
    await expect(new PushRepository(dynamo).unregister('u1', TOKEN)).resolves.toBeUndefined();
    expect(sent[1].input.Key).toEqual({ PK: 'PUSHUSER#u1', SK: `TOKEN#${TOKEN}` });
  });

  it("lists a user's devices from their partition, every page", async () => {
    const { dynamo, sent } = mockDynamo([
      {
        Items: [{ PK: 'PUSHUSER#u1', SK: `TOKEN#${TOKEN}`, token: TOKEN, userId: 'u1', platform: 'ios', createdAt: AT, updatedAt: AT }],
        LastEvaluatedKey: { PK: 'PUSHUSER#u1', SK: `TOKEN#${TOKEN}` },
      },
      { Items: [{ PK: 'PUSHUSER#u1', SK: 'TOKEN#ExpoPushToken[two]', token: 'ExpoPushToken[two]', userId: 'u1', platform: 'android', createdAt: AT, updatedAt: AT }] },
    ]);
    const rows = await new PushRepository(dynamo).tokensFor('u1');

    expect(rows).toEqual([
      { token: TOKEN, userId: 'u1', platform: 'ios', createdAt: AT, updatedAt: AT },
      { token: 'ExpoPushToken[two]', userId: 'u1', platform: 'android', createdAt: AT, updatedAt: AT },
    ]);
    expect(sent[0]).toMatchObject({
      name: 'QueryCommand',
      input: {
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
        ExpressionAttributeValues: { ':pk': 'PUSHUSER#u1', ':sk': 'TOKEN#' },
      },
    });
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'PUSHUSER#u1', SK: `TOKEN#${TOKEN}` });
  });
});

/**
 * One push per event: `PUSHSENT#<occurrence>` is claimed with a conditional
 * Put before anything is sent, so an SQS redelivery (or a second messaging
 * task hearing the same realtime frame) finds it taken. The row expires on
 * the table's TTL after a week.
 */
describe('PushRepository — once per event', () => {
  it('claims an occurrence once', async () => {
    const { dynamo, sent } = mockDynamo([{}, conditionalCheckFailed()]);
    const repo = new PushRepository(dynamo);

    expect(await repo.claim('job_assigned#evt-1', AT)).toBe(true);
    expect(await repo.claim('job_assigned#evt-1', AT)).toBe(false);
    expect(sent[0]).toMatchObject({
      name: 'PutCommand',
      input: {
        Item: {
          PK: 'PUSHSENT#job_assigned#evt-1',
          SK: 'METADATA',
          occurrence: 'job_assigned#evt-1',
          claimedAt: AT,
          expiresAt: Math.floor(Date.parse(AT) / 1000) + 7 * 24 * 60 * 60,
        },
        ConditionExpression: 'attribute_not_exists(PK)',
      },
    });
  });

  it('rethrows a table error', async () => {
    const { dynamo } = mockDynamo([new Error('throttled')]);
    await expect(new PushRepository(dynamo).claim('x', AT)).rejects.toThrow('throttled');
  });
});
