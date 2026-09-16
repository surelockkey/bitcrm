import { type AutomationRule } from '@bitcrm/types';
import { bitcrmId } from '../../../src/automations/translator/workiz-ids';
import {
  AutomationsService,
  BuiltinRuleNotDeletableException,
  RuleNotRunnableException,
} from '../../../src/automations/automations.service';
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
    delete: jest.fn(async (id: string) => {
      rows.delete(id);
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

  // --- the Automation Center writes rules of its own (create)

  const smsSpec = {
    version: 1,
    trigger: { kind: 'deal.status_changed', to: ['canceled'] },
    conditions: [],
    actions: [{ type: 'send_sms', to: 'assigned_techs', body: 'Job {{job_id}} was canceled' }],
  } as never;

  it('creates a rule off, owned here, with a uuid the translator will never touch', async () => {
    const { service, rows } = makeService();
    const created = await service.create({ name: '  Job canceled — techs  ', spec: smsSpec }, caller);

    expect(created.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(created).toMatchObject({
      name: 'Job canceled — techs',
      enabled: false,
      source: 'bitcrm',
      specSource: 'user',
      runnable: true,
      createdBy: 'u1',
      updatedBy: 'u1',
    });
    expect(created.notRunnableReason).toBeUndefined();
    expect(created.createdAt).toBe(created.updatedAt);
    expect(rows.get(created.id)!.spec!.trigger.kind).toBe('deal.status_changed');

    // Read back: a `user` spec is never re-translated, even with no Workiz data on the row.
    expect((await service.get(created.id)).specSource).toBe('user');
  });

  it('creates a rule switched on when asked, and carries the library section and blurb', async () => {
    const { service } = makeService();
    const created = await service.create(
      { name: 'Missed call text', spec: smsSpec, enabled: true, category: 'phone', description: 'Texts back' },
      caller,
    );
    expect(created).toMatchObject({ enabled: true, category: 'phone', description: 'Texts back' });
  });

  it('refuses to create an enabled rule the engine cannot act on, with the same 422 as PATCH', async () => {
    const { service, repo } = makeService();
    const emailOnly = {
      version: 1,
      trigger: { kind: 'deal.created' },
      conditions: [],
      actions: [{ type: 'send_email', to: 'client', body: 'Hi' }],
    } as never;

    const err = await service.create({ name: 'Email only', spec: emailOnly, enabled: true }, caller).catch((e) => e);
    expect(err).toBeInstanceOf(RuleNotRunnableException);
    expect(err.getStatus()).toBe(422);
    expect(err.message).toMatch(/^RULE_NOT_RUNNABLE/);
    expect(err.message).toMatch(/email/i);
    expect(repo.put).not.toHaveBeenCalled();

    // The same rule created off is stored, and says why it cannot be switched on.
    const off = await service.create({ name: 'Email only', spec: emailOnly }, caller);
    expect(off).toMatchObject({ enabled: false, runnable: false });
    expect(off.notRunnableReason).toMatch(/email/i);
    await expect(service.update(off.id, { enabled: true }, caller)).rejects.toBeInstanceOf(RuleNotRunnableException);
  });

  // --- duplicate

  it('copies what describes the rule and none of what describes its life', async () => {
    const { service } = makeService([
      translatable({
        category: 'job',
        description: 'Texts the techs when the client cancels',
        notifyMedium: 'sms',
        externalId: 'workiz:automation:619585cd235c17000843d4e1',
        workizTriggered: 5411,
        workizEnabled: true,
        firedCount: 12,
        lastFiredAt: T0,
        enabled: true,
      }),
    ]);
    const copy = await service.duplicate('w3', undefined, caller);

    expect(copy).toMatchObject({
      name: 'Canceled job & techs (copy)',
      enabled: false,
      category: 'job',
      description: 'Texts the techs when the client cancels',
      notifyMedium: 'sms',
      source: 'bitcrm',
      specSource: 'user',
      runnable: true,
      createdBy: 'u1',
      updatedBy: 'u1',
    });
    expect(copy.id).not.toBe('w3');
    // The spec is the one the original evaluates to today, frozen as ours.
    expect(copy.spec).toEqual((await service.get('w3')).spec);
    for (const gone of ['externalId', 'workizTriggered', 'workizEnabled', 'firedCount', 'lastFiredAt']) {
      expect(copy).not.toHaveProperty(gone);
    }
    // The original is untouched.
    expect(await service.get('w3')).toMatchObject({ enabled: true, firedCount: 12, source: 'workiz' });
  });

  it('numbers the copies, takes a name when given, and never collides with an existing one', async () => {
    const { service } = makeService([translatable()]);
    expect((await service.duplicate('w3', undefined, caller)).name).toBe('Canceled job & techs (copy)');
    expect((await service.duplicate('w3', undefined, caller)).name).toBe('Canceled job & techs (copy 2)');
    expect((await service.duplicate('w3', undefined, caller)).name).toBe('Canceled job & techs (copy 3)');
    // A copy of a copy starts its own run.
    const copyOfCopy = await service.duplicate(
      (await service.list()).find((r) => r.name === 'Canceled job & techs (copy)')!.id,
      undefined,
      caller,
    );
    expect(copyOfCopy.name).toBe('Canceled job & techs (copy) (copy)');

    const named = await service.duplicate('w3', '  Bronx cancellations  ', caller);
    expect(named.name).toBe('Bronx cancellations');
  });

  it('keeps a copy inside the 120 characters a name may have', async () => {
    const { service } = makeService([translatable({ name: 'C'.repeat(120) })]);
    const copy = await service.duplicate('w3', undefined, caller);
    expect(copy.name).toHaveLength(120);
    expect(copy.name.endsWith(' (copy)')).toBe(true);
  });

  it('a copy of a rule the engine cannot run keeps the original reason and cannot be switched on', async () => {
    const { service } = makeService([workizRule({ id: 'w4', name: 'Invoice due', entities: ['invoice'], events: [] })]);
    const copy = await service.duplicate('w4', undefined, caller);
    expect(copy).toMatchObject({ name: 'Invoice due (copy)', enabled: false, runnable: false });
    expect(copy.notRunnableReason).toMatch(/invoice/i);
    await expect(service.update(copy.id, { enabled: true }, caller)).rejects.toBeInstanceOf(RuleNotRunnableException);
  });

  it('404s duplicating a rule that is not there', async () => {
    const { service } = makeService();
    await expect(service.duplicate('nope', undefined, caller)).rejects.toMatchObject({ status: 404 });
  });

  // --- delete

  it('deletes a rule of ours and an imported Workiz one, and 404s an unknown id', async () => {
    const { service, repo, rows } = makeService([workizRule()]);
    const mine = await service.create({ name: 'Mine', spec: smsSpec }, caller);

    expect(await service.remove(mine.id, caller)).toEqual({ id: mine.id });
    expect(rows.has(mine.id)).toBe(false);
    expect(await service.remove('w1', caller)).toEqual({ id: 'w1' });
    expect(repo.delete).toHaveBeenCalledWith('w1');
    expect(await service.list()).toHaveLength(3); // only the built-ins are left

    await expect(service.remove('nope', caller)).rejects.toMatchObject({ status: 404 });
  });

  it('refuses to delete a built-in rule, stored or not — switching it off is the way to stop it', async () => {
    const { service, repo } = makeService([{ ...BUILTIN_RULES.late, enabled: false, updatedAt: T0 }]);

    for (const id of ['new-job-sms', 'late']) {
      const err = await service.remove(id, caller).catch((e) => e);
      expect(err).toBeInstanceOf(BuiltinRuleNotDeletableException);
      expect(err.getStatus()).toBe(422);
      expect(err.message).toMatch(/^BUILTIN_RULE_NOT_DELETABLE/);
      expect(err.message).toMatch(/switch it off/);
    }
    expect(repo.delete).not.toHaveBeenCalled();
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
