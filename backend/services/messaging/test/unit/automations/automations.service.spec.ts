import { type AutomationRule } from '@bitcrm/types';
import { bitcrmId } from '../../../src/automations/translator/workiz-ids';
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

  it('refuses to enable an imported Workiz rule with nothing runnable, but lets it be disabled or renamed', async () => {
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

  // --- the rule engine (M21 L): specs come from the translator at read time

  /** The "Canceled job & techs" shape, as the history loader stored it. */
  const translatable = (over: Partial<AutomationRule> = {}): AutomationRule =>
    workizRule({
      id: 'w3',
      name: 'Canceled job & techs',
      entities: ['job'],
      conditions: {
        all: [
          { fact: 'account_id', entity: 'account', operator: 'equal', value: '2774' },
          { fact: 'tech_names', operator: 'notEqual', value: '' },
          { fact: 'sub_status_id', operator: 'equal', value: '15037', friendly_strings: { value: 'canceled check' } },
        ],
      },
      events: [
        {
          type: 'notification',
          notify_medium: 'sms',
          receiverType: 'tech',
          message_template: '<p>CLIENT CANCELED {{uuid}}</p>',
          time_interval: { value: 0, time_unit: 'minutes' },
        },
      ],
      ...over,
    });

  it('translates an imported rule on the way out, without writing anything', async () => {
    const { service, repo } = makeService([translatable()]);
    const rule = await service.get('w3');

    expect(rule.runnable).toBe(true);
    expect(rule.specSource).toBe('workiz-translator');
    expect(rule.spec?.trigger).toEqual({ kind: 'deal.status_changed', toSubStatus: [bitcrmId('substatus', '15037')] });
    expect(rule.specNotes?.length).toBeGreaterThan(0);
    // The imported Workiz shape is untouched next to it.
    expect(rule.conditions).toEqual(translatable().conditions);
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('lets a translated rule be switched on, and says why when it cannot be', async () => {
    const { service } = makeService([translatable(), workizRule({ id: 'w4', entities: ['invoice'], events: [] })]);
    const on = await service.update('w3', { enabled: true }, caller);
    expect(on.enabled).toBe(true);

    const err = await service.update('w4', { enabled: true }, caller).catch((e) => e);
    expect(err).toBeInstanceOf(RuleNotRunnableException);
    expect(err.message).toContain('invoice');
  });

  it('a hand-edited spec is the rule from then on and is never re-translated', async () => {
    const { service, rows } = makeService([translatable()]);
    const edited = await service.update(
      'w3',
      {
        spec: {
          version: 1,
          trigger: { kind: 'deal.created' },
          conditions: [],
          actions: [{ type: 'send_sms', to: 'client', body: 'Welcome' }],
        } as never,
      },
      caller,
    );
    expect(edited.specSource).toBe('user');
    expect(edited.runnable).toBe(true);
    expect(rows.get('w3')!.spec!.trigger.kind).toBe('deal.created');

    const read = await service.get('w3');
    expect(read.spec?.trigger.kind).toBe('deal.created'); // not translated back
  });

  it('a saved spec the engine cannot act on stays not runnable and cannot be switched on', async () => {
    const { service } = makeService([translatable()]);
    const emailOnly = await service.update(
      'w3',
      {
        spec: {
          version: 1,
          trigger: { kind: 'deal.created' },
          conditions: [],
          actions: [{ type: 'send_email', to: 'client', body: 'Welcome' }],
        } as never,
      },
      caller,
    );
    expect(emailOnly.runnable).toBe(false);
    expect(emailOnly.notRunnableReason).toMatch(/email/i);

    const err = await service.update('w3', { enabled: true }, caller).catch((e) => e);
    expect(err).toBeInstanceOf(RuleNotRunnableException);

    // Adding an action the engine performs makes it runnable again.
    const withSms = await service.update(
      'w3',
      {
        spec: {
          version: 1,
          trigger: { kind: 'deal.created' },
          conditions: [],
          actions: [{ type: 'send_email', to: 'client', body: 'Welcome' }, { type: 'send_sms', to: 'client', body: 'Hi' }],
        } as never,
      },
      caller,
    );
    expect(withSms.runnable).toBe(true);
    expect(withSms.notRunnableReason).toBeUndefined();
    expect((await service.update('w3', { enabled: true }, caller)).enabled).toBe(true);
  });

  it('migrate writes the specs once and reports the coverage table', async () => {
    const { service, repo, rows } = makeService([
      translatable({ workizTriggered: 5411 }),
      workizRule({ id: 'w4', name: 'Invoice due', entities: ['invoice'], workizTriggered: 5, events: [] }),
    ]);
    const table = await service.migrate(caller);

    expect(table.map((r) => [r.name, r.runnable, r.written])).toEqual([
      ['Canceled job & techs', true, true],
      ['Invoice due', false, true],
    ]);
    expect(table[0].trigger).toBe('deal.status_changed');
    expect(table[0].actions).toEqual(['send_sms:assigned_techs']);
    expect(table[1].reason).toMatch(/invoice/);
    expect(rows.get('w3')!.specSource).toBe('workiz-translator');

    // Running it again writes nothing: the rows are already on this version.
    repo.put.mockClear();
    const again = await service.migrate(caller);
    expect(again.every((r) => !r.written)).toBe(true);
    expect(repo.put).not.toHaveBeenCalled();
  });

  it('migrate leaves a hand-edited rule alone and can report without writing', async () => {
    const { service, repo } = makeService([
      { ...translatable(), specSource: 'user', spec: { version: 1, trigger: { kind: 'deal.created' }, conditions: [], actions: [] } },
      workizRule({ id: 'w5', name: 'Other', entities: ['invoice'], events: [] }),
    ]);
    const table = await service.migrate(caller, { dryRun: true });
    expect(table.map((r) => r.id)).toEqual(['w5']);
    expect(table[0].written).toBe(false);
    expect(repo.put).not.toHaveBeenCalled();
  });
});
