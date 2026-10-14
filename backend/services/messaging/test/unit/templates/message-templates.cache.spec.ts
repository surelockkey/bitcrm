import { type MessageTemplate } from '@bitcrm/types';
import { MESSAGE_TEMPLATES_CACHE_KEY, MessageTemplatesService } from '../../../src/templates/message-templates.service';
import { FakeRedis, fakeRedisService } from '../fake-redis';
import { createMockTemplate } from '../mocks';

/**
 * `GET /templates` reads the catalog through a Redis cache (B7): every row,
 * archived included, kept 5 minutes and dropped by every template write;
 * the active / channel views are cut from it in memory, so the response is
 * what it was.
 */
function makeService(templates: MessageTemplate[], redis = new FakeRedis()) {
  const store = new Map(templates.map((t) => [t.id, t]));
  const repo = {
    create: jest.fn(async (t: MessageTemplate) => void store.set(t.id, t)),
    put: jest.fn(async (t: MessageTemplate) => void store.set(t.id, t)),
    get: jest.fn(async (id: string) => store.get(id) ?? null),
    list: jest.fn(async (opts: { includeInactive?: boolean } = {}) =>
      [...store.values()].filter((t) => opts.includeInactive || t.active),
    ),
    archive: jest.fn(async (id: string) => {
      const t = store.get(id);
      if (t) store.set(id, { ...t, active: false });
    }),
    remove: jest.fn(async (id: string) => void store.delete(id)),
  };
  return { service: new MessageTemplatesService(repo as any, undefined, fakeRedisService(redis)), repo, store, redis };
}

const caller = { id: 'u9' };
const a = createMockTemplate({ id: 'a', messageTemplateTitle: 'Alpha', channel: 'sms' });
const b = createMockTemplate({ id: 'b', messageTemplateTitle: 'beta', channel: 'email' });
const old = createMockTemplate({ id: 'z', messageTemplateTitle: 'Old', channel: 'any', active: false });

describe('MessageTemplatesService list cache', () => {
  it('reads the catalog once and serves every view from the cache, for 5 minutes', async () => {
    const { service, repo, redis } = makeService([a, b, old]);
    expect((await service.list()).map((t) => t.id)).toEqual(['a', 'b']);
    expect((await service.list({ channel: 'sms' })).map((t) => t.id)).toEqual(['a']);
    expect((await service.list({ includeInactive: true })).map((t) => t.id)).toEqual(['a', 'b', 'z']);
    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(redis.ttl(MESSAGE_TEMPLATES_CACHE_KEY)).toBe(300);
  });

  it('serves full rows — the composer inserts the body, the form edits messageJson', async () => {
    const { service } = makeService([a]);
    await service.list();
    expect(await service.list()).toEqual([a]);
  });

  it.each([
    ['create', (s: MessageTemplatesService) =>
      s.create({ messageTemplateTitle: 'New', messageTemplate: '<p>x</p>', channel: 'sms' }, caller)],
    ['update', (s: MessageTemplatesService) => s.update('a', { messageTemplateTitle: 'Alpha 2' }, caller)],
    ['archive', (s: MessageTemplatesService) => s.archive('a', caller)],
    ['remove', (s: MessageTemplatesService) => s.remove('z', caller)],
  ])('%s drops the cached list for every task', async (_name, write) => {
    const redis = new FakeRedis();
    const { service, repo } = makeService([a, b, old], redis);
    await service.list();
    await write(service);
    const before = repo.list.mock.calls.length;
    await service.list();
    expect(repo.list).toHaveBeenCalledTimes(before + 1);
  });

  it('shows a write at once, here and on another task', async () => {
    const redis = new FakeRedis();
    const { service, store } = makeService([a], redis);
    const other = new MessageTemplatesService(
      { list: jest.fn(async () => [...store.values()]) } as any,
      undefined,
      fakeRedisService(redis),
    );
    await other.list();
    await service.update('a', { messageTemplateTitle: 'Renamed' }, caller);
    expect((await other.list())[0].messageTemplateTitle).toBe('Renamed');
  });

  it('clears other defaults from the table, not from the cache', async () => {
    const d1 = createMockTemplate({ id: 'd1', messageTemplateTitle: 'D1', channel: 'sms', isDefault: true });
    const { service, store } = makeService([a]);
    await service.list(); // cache knows no default
    store.set('d1', d1); // written by another task
    await service.update('a', { isDefault: true }, caller);
    expect(store.get('d1')!.isDefault).toBe(false);
  });
});
