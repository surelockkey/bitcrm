import { AutomationRunsRepository } from 'src/automations/engine/automation-runs.repository';
import { AutomationsService } from 'src/automations/automations.service';

/**
 * Скільки спрацювань у стрічці активності — число, з якого панель робить
 * «Page 2 of 7».
 *
 * Стрічка йде тими самими партиціями, що й список: партиція самого правила,
 * коли задано `ruleId`, або місяці індексу `AUTORUN#<YYYY-MM>` за вікном
 * зберігання. Лічильник повторює той обхід, але з `Select: 'COUNT'`.
 *
 * `outcome` — не ключ, а фільтр, тож рідкісний результат за все вікно міг би
 * вичерпати бюджет проходу. Тоді відповідь чесно стає «не менше».
 */
function makeRepo(pages: Array<{ Count: number; LastEvaluatedKey?: unknown }>) {
  const sent: Array<{ input: Record<string, any> }> = [];
  let i = 0;
  const send = jest.fn(async (cmd: { input: Record<string, any> }) => {
    sent.push(cmd);
    const res = pages[Math.min(i, pages.length - 1)] ?? { Count: 0 };
    i += 1;
    return res;
  });
  const repo = new AutomationRunsRepository({ client: { send } } as never);
  return { repo, sent };
}

describe('AutomationRunsRepository.countFeed', () => {
  it('counts one rule’s partition without pulling bodies back', async () => {
    const { repo, sent } = makeRepo([{ Count: 41 }]);

    await expect(repo.countFeed({ ruleId: 'rule-1', limit: 50 } as never)).resolves.toEqual({
      total: 41,
      atLeast: false,
    });
    expect(sent[0].input.Select).toBe('COUNT');
    expect(sent[0].input.Limit).toBeUndefined();
  });

  it('carries the outcome filter, so the number matches the rows', async () => {
    const { repo, sent } = makeRepo([{ Count: 2 }]);

    await repo.countFeed({ ruleId: 'rule-1', outcome: 'skipped', limit: 50 } as never);

    expect(sent[0].input.FilterExpression).toContain('#outcome = :outcome');
    expect(sent[0].input.ExpressionAttributeValues[':outcome']).toBe('skipped');
  });

  it('follows the cursor within a partition', async () => {
    const { repo, sent } = makeRepo([
      { Count: 30, LastEvaluatedKey: { PK: 'AUTORUN#a' } },
      { Count: 11 },
    ]);

    await expect(repo.countFeed({ ruleId: 'rule-1', limit: 50 } as never)).resolves.toEqual({
      total: 41,
      atLeast: false,
    });
    expect(sent[1].input.ExclusiveStartKey).toEqual({ PK: 'AUTORUN#a' });
  });

  it('stops on its budget and says the tally is a floor', async () => {
    const { repo } = makeRepo([{ Count: 1, LastEvaluatedKey: { PK: 'AUTORUN#x' } }]);

    const result = await repo.countFeed({ ruleId: 'rule-1', limit: 50 } as never);

    expect(result.atLeast).toBe(true);
  });
});

describe('AutomationsService.countRunsFeed', () => {
  function make() {
    const runs = { countFeed: jest.fn() };
    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => {
          store.set(k, v);
          return 'OK';
        }),
      },
    };
    const service = new AutomationsService({} as never, runs as never, redis as never);
    return { service, runs };
  }

  it('answers how many firings the feed holds', async () => {
    const { service, runs } = make();
    runs.countFeed.mockResolvedValue({ total: 41, atLeast: false });

    await expect(service.countRunsFeed({ limit: 50 } as never)).resolves.toEqual({
      total: 41,
      atLeast: false,
    });
  });

  it('answers a repeat from the cache', async () => {
    const { service, runs } = make();
    runs.countFeed.mockResolvedValue({ total: 41, atLeast: false });

    await service.countRunsFeed({ limit: 50 } as never);
    await service.countRunsFeed({ limit: 50 } as never);

    expect(runs.countFeed).toHaveBeenCalledTimes(1);
  });

  it('counts again when the rule or outcome changes', async () => {
    const { service, runs } = make();
    runs.countFeed.mockResolvedValue({ total: 41, atLeast: false });

    await service.countRunsFeed({ limit: 50 } as never);
    await service.countRunsFeed({ limit: 50, outcome: 'skipped' } as never);

    expect(runs.countFeed).toHaveBeenCalledTimes(2);
  });
});
