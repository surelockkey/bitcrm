import { BadRequestException } from '@nestjs/common';
import { CallsService } from '../../src/calls/calls.service';

/**
 * «Top Call Flows» — вікно днів (не більше 92), обхід журналу, згортка.
 * Відповідь тримається тридцять секунд: дашборд оновлює всі віджети разом.
 */
describe('CallsService.topFlows', () => {
  function make(withRedis = false) {
    const repo = {
      flowCallsByDay: jest.fn().mockResolvedValue({ byFlow: { 'SURE TX': { '2026-09-14': 2 } }, atLeast: false }),
    };
    const store = new Map<string, string>();
    const redis = {
      client: {
        get: jest.fn(async (k: string) => store.get(k) ?? null),
        set: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      },
    };
    const service = new CallsService(
      repo as never,
      undefined, undefined, undefined, undefined, undefined, undefined, undefined,
      (withRedis ? redis : undefined) as never,
    );
    return { service, repo, redis };
  }

  it('folds the tally into a line per flow', async () => {
    const { service } = make();

    const out = await service.topFlows({ from: '2026-09-14', to: '2026-09-15' });

    expect(out.flows).toEqual([{ name: 'SURE TX', counts: [2, 0] }]);
  });

  it.each([
    [{ from: '2026-09-15', to: '2026-09-14' }],
    [{ from: '2026-01-01', to: '2026-09-28' }],
    [{ from: 'yesterday', to: '2026-09-28' }],
    [{ from: undefined, to: '2026-09-28' }],
  ])('refuses a window that is backwards, too long or not days: %j', async (window) => {
    const { service, repo } = make();

    await expect(service.topFlows(window as never)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.flowCallsByDay).not.toHaveBeenCalled();
  });

  it('a second ask within thirty seconds does not walk the log again', async () => {
    const { service, repo } = make(true);

    await service.topFlows({ from: '2026-09-14', to: '2026-09-15' });
    const again = await service.topFlows({ from: '2026-09-14', to: '2026-09-15' });

    expect(repo.flowCallsByDay).toHaveBeenCalledTimes(1);
    expect(again.flows[0].name).toBe('SURE TX');
  });
});
