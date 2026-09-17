import { type PushDevice } from '@bitcrm/types';
import {
  MESSAGING_TTL_ATTRIBUTE,
  PUSH_DEVICE_TTL_SECONDS,
} from '../../../src/common/constants/dynamo.constants';
import { PushDevicesRepository, expiryOf } from '../../../src/push/push-devices.repository';
import { conditionalCheckFailed, mockDynamo } from '../mocks';

const AT = '2026-09-17T09:00:00.000Z';
const LATER = '2026-09-20T09:00:00.000Z';
const TOKEN = 'ExponentPushToken[abc123]';

const stored = (overrides: Partial<PushDevice> & Record<string, unknown> = {}): Record<string, unknown> => ({
  PK: `DEVICE#${TOKEN}`,
  SK: 'METADATA',
  GSI3PK: 'DEVICEOF#u1',
  GSI3SK: `${AT}#${TOKEN}`,
  token: TOKEN,
  userId: 'u1',
  platform: 'ios',
  registeredAt: AT,
  lastSeenAt: AT,
  [MESSAGING_TTL_ATTRIBUTE]: expiryOf(AT),
  ...overrides,
});

describe('PushDevicesRepository', () => {
  it('writes one row per token, on the DEVICEOF adjacency, with a TTL', async () => {
    const { dynamo, sent } = mockDynamo([{ Item: undefined }, {}]);
    const repo = new PushDevicesRepository(dynamo);

    const device = await repo.register(
      { token: TOKEN, userId: 'u1', platform: 'ios', appVersion: '1.4.0', deviceName: "Ann's iPhone" },
      AT,
    );

    expect(device).toEqual({
      token: TOKEN,
      userId: 'u1',
      platform: 'ios',
      appVersion: '1.4.0',
      deviceName: "Ann's iPhone",
      registeredAt: AT,
      lastSeenAt: AT,
    });
    const put = sent[1];
    expect(put.name).toBe('PutCommand');
    expect(put.input.Item.PK).toBe(`DEVICE#${TOKEN}`);
    expect(put.input.Item.SK).toBe('METADATA');
    // The catalog habit: a constant partition on the EXISTING CategoryIndex.
    expect(put.input.Item.GSI3PK).toBe('DEVICEOF#u1');
    expect(put.input.Item.GSI3SK).toBe(`${AT}#${TOKEN}`);
    expect(put.input.Item[MESSAGING_TTL_ATTRIBUTE]).toBe(
      Math.floor(new Date(AT).getTime() / 1000) + PUSH_DEVICE_TTL_SECONDS,
    );
  });

  it('refreshes an existing token instead of duplicating it, and keeps registeredAt', async () => {
    const { dynamo, sent } = mockDynamo([{ Item: stored() }, {}]);
    const repo = new PushDevicesRepository(dynamo);

    const device = await repo.register({ token: TOKEN, userId: 'u1', platform: 'ios' }, LATER);

    expect(device.registeredAt).toBe(AT);
    expect(device.lastSeenAt).toBe(LATER);
    // Same key, so this is a refresh of one row — the app may call it on every launch.
    expect(sent.filter((c) => c.name === 'PutCommand')).toHaveLength(1);
    expect(sent[1].input.Item.PK).toBe(`DEVICE#${TOKEN}`);
    expect(sent[1].input.Item.GSI3SK).toBe(`${AT}#${TOKEN}`);
    // ... and the TTL moves forward, which is the point of refreshing.
    expect(sent[1].input.Item[MESSAGING_TTL_ATTRIBUTE]).toBe(expiryOf(LATER));
  });

  it('moves a phone that changed hands to its new owner', async () => {
    const { dynamo, sent } = mockDynamo([{ Item: stored() }, {}]);
    const repo = new PushDevicesRepository(dynamo);

    const device = await repo.register({ token: TOKEN, userId: 'u2', platform: 'android' }, LATER);

    // A new owner gets a new registeredAt — and, crucially, the adjacency
    // moves, so u1 is no longer pushed this phone's jobs.
    expect(device.registeredAt).toBe(LATER);
    expect(sent[1].input.Item.GSI3PK).toBe('DEVICEOF#u2');
    expect(sent[1].input.Item.userId).toBe('u2');
  });

  it('lists a user devices off the CategoryIndex, paging, without the key attributes', async () => {
    const { dynamo, sent } = mockDynamo([
      { Items: [stored()], LastEvaluatedKey: { PK: 'x' } },
      { Items: [stored({ PK: 'DEVICE#t2', token: 't2', GSI3SK: `${LATER}#t2` })] },
    ]);
    const repo = new PushDevicesRepository(dynamo);

    const devices = await repo.listByUser('u1');

    expect(sent[0].name).toBe('QueryCommand');
    expect(sent[0].input.IndexName).toBe('CategoryIndex');
    expect(sent[0].input.KeyConditionExpression).toBe('GSI3PK = :pk');
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'DEVICEOF#u1' });
    expect(devices).toHaveLength(2);
    expect(devices[0]).toEqual({
      token: TOKEN,
      userId: 'u1',
      platform: 'ios',
      registeredAt: AT,
      lastSeenAt: AT,
    });
    expect(devices[0]).not.toHaveProperty(MESSAGING_TTL_ATTRIBUTE);
  });

  it('collects every device of several users, without asking twice for a repeated id', async () => {
    const { dynamo, sent } = mockDynamo([{ Items: [stored()] }, { Items: [stored({ GSI3PK: 'DEVICEOF#u2' })] }]);
    const repo = new PushDevicesRepository(dynamo);

    const devices = await repo.listByUsers(['u1', 'u2', 'u1', '']);

    expect(devices).toHaveLength(2);
    expect(sent).toHaveLength(2);
  });

  it('only lets a user unregister their own token', async () => {
    const { dynamo, sent } = mockDynamo([{}]);
    const repo = new PushDevicesRepository(dynamo);

    expect(await repo.removeForUser(TOKEN, 'u1')).toBe(true);
    expect(sent[0].name).toBe('DeleteCommand');
    expect(sent[0].input.ConditionExpression).toBe('attribute_exists(PK) AND userId = :userId');
    expect(sent[0].input.ExpressionAttributeValues).toEqual({ ':userId': 'u1' });
  });

  it('answers false — not an error — when the token is gone or belongs to someone else', async () => {
    const { dynamo } = mockDynamo([conditionalCheckFailed()]);
    const repo = new PushDevicesRepository(dynamo);

    expect(await repo.removeForUser(TOKEN, 'u2')).toBe(false);
  });

  it('rethrows a delete that failed for any other reason', async () => {
    const { dynamo } = mockDynamo([new Error('throttled')]);
    const repo = new PushDevicesRepository(dynamo);

    await expect(repo.removeForUser(TOKEN, 'u1')).rejects.toThrow('throttled');
  });

  it('drops a dead token on Expo word alone, with no owner condition', async () => {
    const { dynamo, sent } = mockDynamo([{}]);
    const repo = new PushDevicesRepository(dynamo);

    await repo.remove(TOKEN);

    expect(sent[0].name).toBe('DeleteCommand');
    expect(sent[0].input.Key).toEqual({ PK: `DEVICE#${TOKEN}`, SK: 'METADATA' });
    expect(sent[0].input.ConditionExpression).toBeUndefined();
  });
});
