import { AUTOMATION_NOTIFICATION_CATEGORY, type AutomationRule } from '@bitcrm/types';
import { AUTOMATIONS_LIST_CACHE_KEY, AutomationsService } from '../../../src/automations/automations.service';
import { TRANSLATOR_VERSION } from '../../../src/automations/translator/workiz-translator';
import { FakeRedis, fakeRedisService } from '../fake-redis';
import { T0 } from '../mocks';

/**
 * `GET /automations` reads the catalog through a Redis cache (B7): the
 * whole composed list — stored rows, translated where outdated, plus the
 * unstored built-ins — kept 5 minutes and dropped by every write.
 */
const workizRule = (overrides: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'w1',
  name: 'Scheduled jobs',
  enabled: false,
  source: 'workiz',
  workizEnabled: true,
  events: [{ type: 'job_status_changed' }] as any,
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

function makeService(stored: AutomationRule[] = [], redis = new FakeRedis()) {
  const rows = new Map(stored.map((r) => [r.id, r]));
  const repo = {
    list: jest.fn(async () => [...rows.values()]),
    get: jest.fn(async (id: string) => rows.get(id) ?? null),
    put: jest.fn(async (rule: AutomationRule) => {
      rows.set(rule.id, rule);
      return rule;
    }),
    delete: jest.fn(async (id: string) => {
      rows.delete(id);
    }),
  };
  const service = new AutomationsService(repo as any, undefined, fakeRedisService(redis));
  return { service, repo, rows, redis };
}

const caller = { id: 'u1' };

describe('AutomationsService list cache', () => {
  it('reads the catalog once and serves the next list from Redis, for 5 minutes', async () => {
    const { service, repo, redis } = makeService([workizRule()]);
    const first = await service.list();
    const second = await service.list();
    expect(second).toEqual(first);
    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(redis.ttl(AUTOMATIONS_LIST_CACHE_KEY)).toBe(300);
  });

  it('names the translator version in the key, so a new translator never serves old translations', () => {
    expect(AUTOMATIONS_LIST_CACHE_KEY).toContain(`t${TRANSLATOR_VERSION}`);
  });

  it('still translates an outdated row on the way out, and caches the translation', async () => {
    const { service, repo } = makeService([workizRule({ specVersion: TRANSLATOR_VERSION - 1, specSource: 'workiz-translator' })]);
    const [rule] = (await service.list()).filter((r) => r.id === 'w1');
    expect(rule).toMatchObject({ specSource: 'workiz-translator', specVersion: TRANSLATOR_VERSION });
    const [again] = (await service.list()).filter((r) => r.id === 'w1');
    expect(again).toEqual(rule);
    expect(repo.list).toHaveBeenCalledTimes(1);
  });

  it('filters category over the cached list', async () => {
    const { service, repo } = makeService([
      workizRule(),
      workizRule({ id: 'n1', name: 'Notice', category: AUTOMATION_NOTIFICATION_CATEGORY, source: 'bitcrm', specSource: 'user' }),
    ]);
    expect((await service.list({ category: AUTOMATION_NOTIFICATION_CATEGORY })).map((r) => r.id)).toEqual(['n1']);
    expect((await service.list()).length).toBeGreaterThan(1);
    expect(repo.list).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['create', (s: AutomationsService) => s.create({ name: 'New', spec: { trigger: { kind: 'job_created' }, actions: [] } } as any, caller)],
    ['update', (s: AutomationsService) => s.update('w1', { name: 'Renamed' }, caller)],
    ['duplicate', (s: AutomationsService) => s.duplicate('w1', undefined, caller)],
    ['remove', (s: AutomationsService) => s.remove('w1', caller)],
    ['migrate', (s: AutomationsService) => s.migrate(caller)],
  ])('%s drops the cached list for every task', async (_name, write) => {
    const redis = new FakeRedis();
    const { service, repo } = makeService([workizRule()], redis);
    const otherTask = makeService([], redis).service; // shares Redis, not the repository
    await service.list();
    expect(repo.list).toHaveBeenCalledTimes(1);

    await write(service);
    const callsAfterWrite = repo.list.mock.calls.length;
    await service.list();
    expect(repo.list).toHaveBeenCalledTimes(callsAfterWrite + 1);
    // Another task reads the fresh list too: it was invalidated in Redis, not in memory.
    expect(redis.peek(AUTOMATIONS_LIST_CACHE_KEY)).not.toBeNull();
    await otherTask.list();
  });

  it('a dry-run migrate writes nothing and keeps the cache', async () => {
    const { service, repo } = makeService([workizRule()]);
    await service.list();
    await service.migrate(caller, { dryRun: true });
    const calls = repo.list.mock.calls.length;
    await service.list();
    expect(repo.list).toHaveBeenCalledTimes(calls);
  });

  it('duplicate picks the copy name from the stored rows, not the cache', async () => {
    const { service, rows } = makeService([workizRule()]);
    await service.list(); // cache holds only "Scheduled jobs"
    rows.set('x', workizRule({ id: 'x', name: 'Scheduled jobs (copy)' })); // written by another task
    const copy = await service.duplicate('w1', undefined, caller);
    expect(copy.name).toBe('Scheduled jobs (copy 2)');
  });

  it('a failed write leaves the cache as it was', async () => {
    const { service, repo } = makeService([workizRule()]);
    await service.list();
    repo.put.mockRejectedValueOnce(new Error('dynamo down'));
    await expect(service.update('w1', { name: 'X' }, caller)).rejects.toThrow('dynamo down');
    await service.list();
    expect(repo.list).toHaveBeenCalledTimes(1);
  });
});
