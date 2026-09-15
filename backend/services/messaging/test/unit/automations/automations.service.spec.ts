import { type AutomationRule } from '@bitcrm/types';
import { AutomationsService, RuleNotRunnableException } from '../../../src/automations/automations.service';
import { BUILTIN_RULES, BUILTIN_RULES_SINCE } from '../../../src/automations/builtin-rules';
import { T0 } from '../mocks';

const workizRule = (overrides: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'w1',
  name: 'Scheduled jobs',
  enabled: false,
  source: 'workiz',
  workizEnabled: true,
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});

function makeService(stored: AutomationRule[] = []) {
  const rows = new Map(stored.map((r) => [r.id, r]));
  const repo = {
    list: jest.fn(async () => [...rows.values()]),
    get: jest.fn(async (id: string) => rows.get(id) ?? null),
    put: jest.fn(async (rule: AutomationRule) => {
      rows.set(rule.id, rule);
      return rule;
    }),
  };
  return { service: new AutomationsService(repo as any), repo, rows };
}

const caller = { id: 'u1' };

describe('AutomationsService', () => {
  it('lists stored rules plus the unstored built-ins, alphabetically', async () => {
    const { service } = makeService([workizRule(), workizRule({ id: 'w2', name: 'Canceled job & techs' })]);
    const rules = await service.list();
    expect(rules.map((r) => r.id)).toEqual(['w2', 'new-job-sms', 'on-my-way', 'late', 'w1']);
    expect(rules.filter((r) => r.builtin).every((r) => r.enabled)).toBe(true);
    expect(rules.find((r) => r.id === 'new-job-sms')!.createdAt).toBe(BUILTIN_RULES_SINCE);
  });

  it('lays a stored built-in row over the code default and does not list it twice', async () => {
    const { service } = makeService([{ ...BUILTIN_RULES['on-my-way'], enabled: false, name: 'OMW', updatedAt: T0, updatedBy: 'u9' }]);
    const rules = await service.list();
    expect(rules.filter((r) => r.id === 'on-my-way')).toHaveLength(1);
    const omw = await service.get('on-my-way');
    expect(omw).toMatchObject({ enabled: false, name: 'OMW', builtin: true, trigger: BUILTIN_RULES['on-my-way'].trigger, updatedBy: 'u9' });
    expect(await service.isEnabled('on-my-way')).toBe(false);
    expect(await service.isEnabled('late')).toBe(true);
  });

  it('404s an unknown rule', async () => {
    const { service } = makeService();
    await expect(service.get('nope')).rejects.toMatchObject({ status: 404 });
    expect(await service.find('nope')).toBeNull();
  });

  it('refuses to enable an imported Workiz rule (no engine) but lets it be disabled or renamed', async () => {
    const { service, repo } = makeService([workizRule({ enabled: false })]);
    const err = await service.update('w1', { enabled: true }, caller).catch((e) => e);
    expect(err).toBeInstanceOf(RuleNotRunnableException);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toMatch(/^RULE_NOT_RUNNABLE/);
    expect(repo.put).not.toHaveBeenCalled();

    const renamed = await service.update('w1', { name: '  Scheduled jobs (SMS)  ', enabled: false }, caller);
    expect(renamed).toMatchObject({ id: 'w1', name: 'Scheduled jobs (SMS)', enabled: false, updatedBy: 'u1', workizEnabled: true });
    expect(renamed.updatedAt > T0).toBe(true);
  });

  it('writes a built-in rule on first edit, keeping the code-level description', async () => {
    const { service, repo, rows } = makeService();
    const saved = await service.update('new-job-sms', { enabled: false }, caller);
    expect(repo.put).toHaveBeenCalledTimes(1);
    expect(saved).toMatchObject({ id: 'new-job-sms', enabled: false, builtin: true, createdBy: 'u1', updatedBy: 'u1', description: BUILTIN_RULES['new-job-sms'].description });
    expect(rows.get('new-job-sms')!.enabled).toBe(false);
    expect(await service.isEnabled('new-job-sms')).toBe(false);
    // and back on
    await service.update('new-job-sms', { enabled: true }, caller);
    expect(await service.isEnabled('new-job-sms')).toBe(true);
  });
});
