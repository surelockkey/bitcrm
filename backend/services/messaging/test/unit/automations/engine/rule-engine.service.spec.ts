import { type AutomationRule, type AutomationSpec } from '@bitcrm/types';
import { AutomationRuleEngine } from '../../../../src/automations/engine/rule-engine.service';
import { type ScheduledFiring } from '../../../../src/automations/engine/schedule.repository';
import { type AutomationEvent } from '../../../../src/automations/engine/trigger-event';

const NOW = new Date('2026-09-16T15:00:00.000Z'); // 11:00 in New York — outside quiet hours
const NIGHT = new Date('2026-09-17T03:00:00.000Z'); // 23:00 in New York — inside them

const spec = (over: Partial<AutomationSpec> = {}): AutomationSpec => ({
  version: 1,
  trigger: { kind: 'deal.status_changed', to: ['done'] },
  conditions: [],
  actions: [{ type: 'send_sms', to: 'client', body: 'Thanks!' }],
  ...over,
});

const rule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'r1',
  name: 'Job done text',
  enabled: true,
  spec: spec(),
  createdAt: NOW.toISOString(),
  updatedAt: NOW.toISOString(),
  ...over,
});

const DEAL = {
  id: 'd1',
  contactId: 'ct1',
  superStatus: 'done',
  assignedTechIds: ['t1'],
  tagIds: [],
  scheduledDate: '2026-09-20',
  scheduledTimeSlot: '09:00-11:00',
  statusChangedAt: '2026-09-16T14:55:00.000Z',
};

const statusEvent: AutomationEvent = {
  kind: 'deal.status_changed',
  at: NOW.toISOString(),
  dealId: 'd1',
  status: { from: 'in_progress', to: 'done' },
};

function harness(over: Record<string, any> = {}) {
  const rules = {
    list: jest.fn(async () => [rule()]),
    find: jest.fn(async () => rule()),
    get: jest.fn(async () => rule()),
    ...(over.rules ?? {}),
  };
  const settings = {
    get: jest.fn(async () => ({ quietHours: { from: '20:00', to: '08:00', timezone: 'America/New_York' } })),
    ...(over.settings ?? {}),
  };
  const peers = { deal: jest.fn(async () => DEAL), ...(over.peers ?? {}) };
  const runs = {
    claim: jest.fn(async () => true),
    release: jest.fn(async () => undefined),
    log: jest.fn(async (r: unknown) => r),
    bump: jest.fn(async () => undefined),
    ...(over.runs ?? {}),
  };
  const schedule = {
    arm: jest.fn(async () => true),
    dueIn: jest.fn(async () => [] as ScheduledFiring[]),
    claim: jest.fn(async () => true),
    remove: jest.fn(async () => undefined),
    ...(over.schedule ?? {}),
  };
  const executor = {
    run: jest.fn(async () => [{ type: 'send_sms', to: 'client', outcome: 'sent', messageId: 'm1' }]),
    ...(over.executor ?? {}),
  };
  const engine = new AutomationRuleEngine(
    rules as any,
    settings as any,
    peers as any,
    runs as any,
    schedule as any,
    executor as any,
  );
  return { engine, rules, settings, peers, runs, schedule, executor };
}

describe('AutomationRuleEngine.handle', () => {
  it('runs a matching rule and logs the firing', async () => {
    const { engine, runs, executor } = harness();
    const [run] = await engine.handle(statusEvent, undefined, NOW);

    expect(executor.run).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ ruleId: 'r1', outcome: 'sent', entity: 'deal:d1', trigger: 'deal.status_changed' });
    expect(runs.claim).toHaveBeenCalledWith('r1', 'deal:d1', expect.stringContaining('status:in_progress>done'), NOW.toISOString());
    expect(runs.bump).toHaveBeenCalledWith('r1', NOW.toISOString());
  });

  it('does nothing twice — a lost claim is a redelivery', async () => {
    const { engine, executor } = harness({ runs: { claim: jest.fn(async () => false) } });
    expect(await engine.handle(statusEvent, undefined, NOW)).toEqual([]);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('skips a rule that is off, has no spec, or was marked not runnable', async () => {
    for (const off of [
      rule({ enabled: false }),
      rule({ spec: undefined }),
      rule({ runnable: false, notRunnableReason: 'no equivalent trigger' }),
    ]) {
      const { engine, executor } = harness({ rules: { list: jest.fn(async () => [off]) } });
      expect(await engine.handle(statusEvent, undefined, NOW)).toEqual([]);
      expect(executor.run).not.toHaveBeenCalled();
    }
  });

  it('holds a firing until quiet hours end instead of texting at 11 pm', async () => {
    const { engine, schedule, executor } = harness();
    const [run] = await engine.handle({ ...statusEvent, at: NIGHT.toISOString() }, undefined, NIGHT);

    expect(executor.run).not.toHaveBeenCalled();
    expect(run).toMatchObject({ outcome: 'scheduled' });
    // 23:00 New York → released at 08:00 local = 12:00 UTC.
    expect(schedule.arm).toHaveBeenCalledWith(
      expect.objectContaining({ ruleId: 'r1', reason: 'quiet_hours', dueAt: '2026-09-17T12:00:00.000Z' }),
    );
  });

  it('honours the rule\'s own quiet-hours mode', async () => {
    const skip = rule({ spec: spec({ timing: { quietHours: 'skip' } }) });
    const { engine: skipping, executor: notSent, runs } = harness({ rules: { list: jest.fn(async () => [skip]) } });
    const [skipped] = await skipping.handle({ ...statusEvent, at: NIGHT.toISOString() }, undefined, NIGHT);
    expect(skipped).toMatchObject({ outcome: 'skipped', reason: 'inside quiet hours' });
    expect(notSent.run).not.toHaveBeenCalled();
    expect(runs.claim).not.toHaveBeenCalled(); // nothing was claimed, nothing was done
    // …and nothing was sent, so the rule's "Fired" count does not move — a
    // redelivery of the same event would otherwise bump it again.
    expect(runs.bump).not.toHaveBeenCalled();

    const ignore = rule({ spec: spec({ timing: { quietHours: 'ignore' } }) });
    const { engine: ignoring, executor: sent } = harness({ rules: { list: jest.fn(async () => [ignore]) } });
    await ignoring.handle({ ...statusEvent, at: NIGHT.toISOString() }, undefined, NIGHT);
    expect(sent.run).toHaveBeenCalled();
  });

  it('arms a delayed rule for its minute instead of sending now', async () => {
    const delayed = rule({ spec: spec({ timing: { delayMinutes: 1440 } }) });
    const { engine, schedule, executor } = harness({ rules: { list: jest.fn(async () => [delayed]) } });
    const [run] = await engine.handle(statusEvent, undefined, NOW);

    expect(executor.run).not.toHaveBeenCalled();
    expect(run).toMatchObject({ outcome: 'scheduled', dueAt: '2026-09-17T15:00:00.000Z' });
    expect(schedule.arm).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'delay', dueAt: '2026-09-17T15:00:00.000Z', event: expect.any(String) }),
    );
  });

  it('gives the claim back when the timer could not be written', async () => {
    const delayed = rule({ spec: spec({ timing: { delayMinutes: 60 } }) });
    const { engine, runs } = harness({
      rules: { list: jest.fn(async () => [delayed]) },
      schedule: { arm: jest.fn(async () => { throw new Error('table down'); }) },
    });
    await engine.handle(statusEvent, undefined, NOW);
    expect(runs.release).toHaveBeenCalledWith('r1', 'deal:d1', expect.any(String));
  });

  it('fills the sub-status the event does not carry from the job itself', async () => {
    const subRule = rule({ spec: spec({ trigger: { kind: 'deal.status_changed', toSubStatus: ['sub-ooa'] } }) });
    const { engine, executor } = harness({
      rules: { list: jest.fn(async () => [subRule]) },
      peers: { deal: jest.fn(async () => ({ ...DEAL, subStatusId: 'sub-ooa' })) },
    });
    await engine.handle(statusEvent, undefined, NOW);
    expect(executor.run).toHaveBeenCalled();
  });

  it('arms a relative reminder from the job date and not for a moment already past', async () => {
    const reminder = rule({
      id: 'rem',
      spec: spec({ trigger: { kind: 'schedule.relative', anchor: 'scheduledStart', offsetMinutes: -60 } }),
    });
    const { engine, schedule } = harness({ rules: { list: jest.fn(async () => [reminder]) } });
    await engine.handle({ kind: 'deal.updated', at: NOW.toISOString(), dealId: 'd1' }, undefined, NOW);

    // 2026-09-20 09:00 New York = 13:00 UTC; one hour before = 12:00 UTC.
    expect(schedule.arm).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'relative', dueAt: '2026-09-20T12:00:00.000Z', anchorAt: '2026-09-20T13:00:00.000Z' }),
    );

    const past = new Date('2026-09-21T00:00:00.000Z');
    const { engine: late, schedule: none } = harness({ rules: { list: jest.fn(async () => [reminder]) } });
    await late.handle({ kind: 'deal.updated', at: past.toISOString(), dealId: 'd1' }, undefined, past);
    expect(none.arm).not.toHaveBeenCalled();
  });
});

describe('AutomationRuleEngine.tick', () => {
  const armed = (over: Partial<ScheduledFiring> = {}): ScheduledFiring => ({
    ruleId: 'r1',
    entity: 'deal:d1',
    occurrence: 'status:in_progress>done',
    dueAt: '2026-09-16T14:59:00.000Z',
    dealId: 'd1',
    reason: 'delay',
    event: JSON.stringify(statusEvent),
    createdAt: '2026-09-15T14:59:00.000Z',
    ...over,
  });

  it('runs what was armed for a minute that has passed and clears it', async () => {
    const item = armed();
    const { engine, schedule, executor, runs } = harness({
      schedule: { dueIn: jest.fn(async (m: string) => (m === '2026-09-16T14:59' ? [item] : [])), arm: jest.fn() },
    });
    (engine as unknown as { lastMinuteMs: number }).lastMinuteMs = new Date('2026-09-16T14:59:00.000Z').getTime();

    expect(await engine.tick(NOW)).toBe(1);
    expect(executor.run).toHaveBeenCalled();
    expect(schedule.claim).toHaveBeenCalledWith(item);
    expect(runs.claim).not.toHaveBeenCalled(); // claimed when it was armed
  });

  it('claims the row before it acts, so a second task firing the same minute sends nothing', async () => {
    const item = armed();
    const { engine, executor, schedule } = harness({
      schedule: {
        dueIn: jest.fn(async (m: string) => (m === '2026-09-16T14:59' ? [item] : [])),
        arm: jest.fn(),
        claim: jest.fn(async () => false), // the other task took it
      },
    });
    (engine as unknown as { lastMinuteMs: number }).lastMinuteMs = new Date('2026-09-16T14:59:00.000Z').getTime();

    await engine.tick(NOW);
    expect(schedule.claim).toHaveBeenCalledWith(item);
    expect(executor.run).not.toHaveBeenCalled();
  });

  it('never runs two sweeps at once — a slow catch-up is not overlapped', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const dueIn = jest.fn(async () => {
      await gate;
      return [] as ScheduledFiring[];
    });
    const { engine, schedule } = harness({ schedule: { dueIn } });
    (engine as unknown as { lastMinuteMs: number }).lastMinuteMs = new Date('2026-09-16T14:50:00.000Z').getTime();

    const first = engine.tick(NOW);
    expect(await engine.tick(NOW)).toBe(0); // skipped while the first is in flight
    release();
    await first;
    // Ten buckets, read once each: the second tick read none of them again.
    expect(schedule.dueIn).toHaveBeenCalledTimes(10);
  });

  it('records a firing whose actions threw instead of losing it', async () => {
    const item = armed();
    const { engine, runs } = harness({
      schedule: { dueIn: jest.fn(async (m: string) => (m === '2026-09-16T14:59' ? [item] : [])), arm: jest.fn() },
      executor: {
        run: jest.fn(async () => {
          throw new Error('renderer down');
        }),
      },
    });
    (engine as unknown as { lastMinuteMs: number }).lastMinuteMs = new Date('2026-09-16T14:59:00.000Z').getTime();

    expect(await engine.tick(NOW)).toBe(0); // it did not count as fired
    expect(runs.log).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'failed', reason: 'renderer down' }));
    expect(runs.bump).not.toHaveBeenCalled();
  });

  it('leaves the minute in progress alone', async () => {
    const { engine, schedule } = harness();
    (engine as unknown as { lastMinuteMs: number }).lastMinuteMs = NOW.getTime();
    expect(await engine.tick(NOW)).toBe(0);
    expect(schedule.dueIn).not.toHaveBeenCalled();
  });

  it('drops a firing whose rule no longer applies', async () => {
    const item = armed();
    const canceled = rule({ spec: spec({ conditions: [{ field: 'status', op: 'in', values: ['done'] }] }) });
    const { engine, schedule, executor, runs } = harness({
      rules: { find: jest.fn(async () => canceled) },
      peers: { deal: jest.fn(async () => ({ ...DEAL, superStatus: 'canceled' })) },
      schedule: { dueIn: jest.fn(async (m: string) => (m === '2026-09-16T14:59' ? [item] : [])), arm: jest.fn() },
    });
    (engine as unknown as { lastMinuteMs: number }).lastMinuteMs = new Date('2026-09-16T14:59:00.000Z').getTime();

    await engine.tick(NOW);
    expect(executor.run).not.toHaveBeenCalled();
    expect(schedule.claim).toHaveBeenCalledWith(item);
    expect(runs.bump).not.toHaveBeenCalled(); // a skipped firing is not a firing
  });

  it('drops a reminder whose job was rescheduled after it was armed, and gives its claim back', async () => {
    const item = armed({ reason: 'relative', anchorAt: '2026-09-20T13:00:00.000Z' });
    const reminder = rule({ spec: spec({ trigger: { kind: 'schedule.relative', anchor: 'scheduledStart', offsetMinutes: -60 } }) });
    const { engine, schedule, executor, runs } = harness({
      rules: { find: jest.fn(async () => reminder) },
      peers: { deal: jest.fn(async () => ({ ...DEAL, scheduledDate: '2026-09-25' })) },
      schedule: { dueIn: jest.fn(async (m: string) => (m === '2026-09-16T14:59' ? [item] : [])), arm: jest.fn() },
    });
    (engine as unknown as { lastMinuteMs: number }).lastMinuteMs = new Date('2026-09-16T14:59:00.000Z').getTime();

    await engine.tick(NOW);
    expect(executor.run).not.toHaveBeenCalled();
    expect(schedule.claim).toHaveBeenCalledWith(item);
    // The job may be moved back to 20 Sep: the occurrence must be free to re-arm.
    expect(runs.release).toHaveBeenCalledWith('r1', 'deal:d1', 'status:in_progress>done');
  });

  it('re-arms a firing that came due inside quiet hours', async () => {
    const item = armed({ dueAt: '2026-09-17T02:59:00.000Z' });
    const { engine, schedule, executor } = harness({
      schedule: { dueIn: jest.fn(async (m: string) => (m === '2026-09-17T02:59' ? [item] : [])), arm: jest.fn(), remove: jest.fn() },
    });
    (engine as unknown as { lastMinuteMs: number }).lastMinuteMs = new Date('2026-09-17T02:59:00.000Z').getTime();

    await engine.tick(NIGHT);
    expect(executor.run).not.toHaveBeenCalled();
    expect(schedule.arm).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'quiet_hours', dueAt: '2026-09-17T12:00:00.000Z' }),
    );
  });
});

describe('AutomationRuleEngine.testRun', () => {
  it('renders and resolves against a real job without sending', async () => {
    const { engine, executor, runs } = harness();
    const run = await engine.testRun('r1', 'd1', NOW);
    expect(run.outcome).toBe('dry_run');
    expect(executor.run).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ dryRun: true }));
    expect(runs.log).not.toHaveBeenCalled(); // a test run is not history
  });

  it('explains why a rule would not fire for the job', async () => {
    const { engine } = harness({
      rules: { get: jest.fn(async () => rule({ spec: spec({ conditions: [{ field: 'tag', op: 'in', values: ['tag-x'] }] }) })) },
    });
    const run = await engine.testRun('r1', 'd1', NOW);
    expect(run).toMatchObject({ outcome: 'skipped', reason: expect.stringContaining('tag') });
  });

  it('says so when the rule has no runnable spec', async () => {
    const { engine } = harness({
      rules: { get: jest.fn(async () => rule({ spec: undefined, notRunnableReason: 'invoice rules have no equivalent' })) },
    });
    expect(await engine.testRun('r1', 'd1', NOW)).toMatchObject({
      outcome: 'skipped',
      reason: 'invoice rules have no equivalent',
    });
  });
});
