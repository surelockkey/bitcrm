import {
  type AutomationConditionGroup,
  type AutomationConditionNode,
  type AutomationSpec,
  type AutomationTrigger,
} from '@bitcrm/types';
import {
  evaluateRule,
  matchesCondition,
  matchesConditionGroup,
  matchesConditions,
  matchesTrigger,
} from '../../../../src/automations/engine/evaluator';
import { type AutomationDealFacts, type AutomationFacts } from '../../../../src/automations/engine/facts';
import { occurrenceOf, type AutomationEvent } from '../../../../src/automations/engine/trigger-event';

const NOW = new Date('2026-09-16T15:00:00.000Z');

const deal = (over: Partial<AutomationDealFacts> = {}): AutomationDealFacts => ({
  id: 'd1',
  contactId: 'ct1',
  superStatus: 'submitted',
  subStatusId: 'sub-scheduled',
  tagIds: ['tag-a', 'tag-b'],
  sourceId: 'src-1',
  jobTypeId: 'jt-1',
  serviceAreaId: 'sa-1',
  assignedTechIds: ['t1', 't2'],
  assignedDispatcherId: 'u-disp',
  scheduledDate: '2026-09-20',
  statusChangedAt: '2026-09-16T14:00:00.000Z',
  ...over,
});

const facts = (over: Partial<AutomationDealFacts> = {}): AutomationFacts => ({ deal: deal(over) });

const spec = (over: Partial<AutomationSpec> = {}): AutomationSpec => ({
  version: 1,
  trigger: { kind: 'deal.status_changed', to: ['done'] },
  conditions: [],
  actions: [{ type: 'send_sms', to: 'client', body: 'hi' }],
  ...over,
});

const statusEvent = (to: string, over: Partial<AutomationEvent> = {}): AutomationEvent => ({
  kind: 'deal.status_changed',
  at: NOW.toISOString(),
  dealId: 'd1',
  status: { from: 'submitted', to },
  ...over,
});

describe('automation trigger matrix', () => {
  it('deal.created takes only the creation event', () => {
    const t: AutomationTrigger = { kind: 'deal.created' };
    expect(matchesTrigger(t, { kind: 'deal.created', at: NOW.toISOString(), dealId: 'd1' }).matched).toBe(true);
    expect(matchesTrigger(t, statusEvent('done')).matched).toBe(false);
  });

  it('deal.status_changed filters on the status entered', () => {
    const t: AutomationTrigger = { kind: 'deal.status_changed', to: ['done', 'canceled'] };
    expect(matchesTrigger(t, statusEvent('done')).matched).toBe(true);
    expect(matchesTrigger(t, statusEvent('in_progress')).matched).toBe(false);
  });

  it('deal.status_changed with no `to` takes any status', () => {
    expect(matchesTrigger({ kind: 'deal.status_changed' }, statusEvent('whatever')).matched).toBe(true);
  });

  it('deal.status_changed filters on the status left and the sub-status entered', () => {
    const t: AutomationTrigger = {
      kind: 'deal.status_changed',
      to: ['done'],
      from: ['in_progress'],
      toSubStatus: ['sub-paid'],
    };
    expect(matchesTrigger(t, statusEvent('done', { status: { from: 'submitted', to: 'done' } })).matched).toBe(false);
    expect(
      matchesTrigger(t, statusEvent('done', { status: { from: 'in_progress', to: 'done', toSubStatusId: 'sub-paid' } }))
        .matched,
    ).toBe(true);
  });

  it('a job created straight into the status fires (Workiz), unless onCreate is off', () => {
    const created: AutomationEvent = {
      kind: 'deal.created',
      at: NOW.toISOString(),
      dealId: 'd1',
      status: { to: 'submitted' },
    };
    expect(matchesTrigger({ kind: 'deal.status_changed', to: ['submitted'] }, created).matched).toBe(true);
    expect(
      matchesTrigger({ kind: 'deal.status_changed', to: ['submitted'], onCreate: false }, created).matched,
    ).toBe(false);
  });

  it('deal.tech_assigned and deal.scheduled_changed take only their own event', () => {
    const assigned: AutomationEvent = { kind: 'deal.tech_assigned', at: NOW.toISOString(), dealId: 'd1', techId: 't1' };
    expect(matchesTrigger({ kind: 'deal.tech_assigned' }, assigned).matched).toBe(true);
    expect(matchesTrigger({ kind: 'deal.scheduled_changed' }, assigned).matched).toBe(false);
  });

  it('deal.updated listens to every job event (the Workiz "has a status of X and tag Y" rule)', () => {
    const t: AutomationTrigger = { kind: 'deal.updated' };
    for (const kind of ['deal.created', 'deal.updated', 'deal.status_changed', 'deal.tech_assigned', 'deal.scheduled_changed'] as const) {
      expect(matchesTrigger(t, { kind, at: NOW.toISOString(), dealId: 'd1' }).matched).toBe(true);
    }
    expect(matchesTrigger(t, { kind: 'call.completed', at: NOW.toISOString() }).matched).toBe(false);
  });

  it('call.completed filters on outcome and direction', () => {
    const missed: AutomationEvent = {
      kind: 'call.completed',
      at: NOW.toISOString(),
      call: { sid: 'CA1', outcome: 'missed', direction: 'inbound' },
    };
    expect(matchesTrigger({ kind: 'call.completed', callOutcome: 'missed' }, missed).matched).toBe(true);
    expect(matchesTrigger({ kind: 'call.completed', callOutcome: 'answered' }, missed).matched).toBe(false);
    expect(
      matchesTrigger({ kind: 'call.completed', callOutcome: 'missed', callDirection: 'outbound' }, missed).matched,
    ).toBe(false);
    expect(matchesTrigger({ kind: 'call.completed' }, missed).matched).toBe(true);
  });

  it('message.received filters on channel and party kind', () => {
    const msg: AutomationEvent = {
      kind: 'message.received',
      at: NOW.toISOString(),
      message: { id: 'm1', channel: 'sms', partyKind: 'contact' },
    };
    expect(matchesTrigger({ kind: 'message.received', messageChannel: 'sms' }, msg).matched).toBe(true);
    expect(matchesTrigger({ kind: 'message.received', messageChannel: 'email' }, msg).matched).toBe(false);
    expect(matchesTrigger({ kind: 'message.received', messagePartyKind: 'user' }, msg).matched).toBe(false);
  });

  it('schedule.relative takes only a timer', () => {
    const timer: AutomationEvent = {
      kind: 'schedule.relative',
      at: NOW.toISOString(),
      dealId: 'd1',
      timer: { ruleId: 'r1', anchorAt: '2026-09-20T13:00:00.000Z', offsetMinutes: -60 },
    };
    expect(matchesTrigger({ kind: 'schedule.relative' }, timer).matched).toBe(true);
    expect(matchesTrigger({ kind: 'schedule.relative' }, statusEvent('done')).matched).toBe(false);
  });
});

describe('automation condition matrix', () => {
  it('in / not_in compare sets (a job carries many tags)', () => {
    expect(matchesCondition({ field: 'tag', op: 'in', values: ['tag-b'] }, facts()).matched).toBe(true);
    expect(matchesCondition({ field: 'tag', op: 'in', values: ['tag-z'] }, facts()).matched).toBe(false);
    expect(matchesCondition({ field: 'tag', op: 'not_in', values: ['tag-z'] }, facts()).matched).toBe(true);
    expect(matchesCondition({ field: 'tag', op: 'not_in', values: ['tag-a'] }, facts()).matched).toBe(false);
  });

  it('eq / ne read the first value only', () => {
    expect(matchesCondition({ field: 'status', op: 'eq', values: ['submitted', 'done'] }, facts()).matched).toBe(true);
    expect(matchesCondition({ field: 'status', op: 'ne', values: ['submitted'] }, facts()).matched).toBe(false);
  });

  it('exists / not_exists answer on the roster', () => {
    expect(matchesCondition({ field: 'hasTechs', op: 'exists' }, facts()).matched).toBe(true);
    expect(matchesCondition({ field: 'hasTechs', op: 'exists' }, facts({ assignedTechIds: [] })).matched).toBe(false);
    expect(matchesCondition({ field: 'hasTechs', op: 'not_exists' }, facts({ assignedTechIds: [] })).matched).toBe(true);
  });

  it('source, jobType, serviceArea, subStatus and dispatcher read their own fact', () => {
    expect(matchesCondition({ field: 'source', op: 'in', values: ['src-1'] }, facts()).matched).toBe(true);
    expect(matchesCondition({ field: 'jobType', op: 'in', values: ['jt-9'] }, facts()).matched).toBe(false);
    expect(matchesCondition({ field: 'serviceArea', op: 'in', values: ['sa-1'] }, facts()).matched).toBe(true);
    expect(matchesCondition({ field: 'subStatus', op: 'in', values: ['sub-scheduled'] }, facts()).matched).toBe(true);
    expect(matchesCondition({ field: 'dispatcher', op: 'in', values: ['u-disp'] }, facts()).matched).toBe(true);
  });

  it('isLead is always false — BitCRM has no separate lead entity', () => {
    expect(matchesCondition({ field: 'isLead', op: 'eq', values: ['false'] }, facts()).matched).toBe(true);
    expect(matchesCondition({ field: 'isLead', op: 'eq', values: ['true'] }, facts()).matched).toBe(false);
  });

  it('an unknown fact never holds — nothing fires on a guess', () => {
    expect(matchesCondition({ field: 'status', op: 'in', values: ['done'] }, {}).matched).toBe(false);
    expect(matchesCondition({ field: 'callDirection', op: 'in', values: ['inbound'] }, facts()).matched).toBe(false);
  });

  it('conditions are ANDed and the first miss is the reason', () => {
    const result = matchesConditions(
      [
        { field: 'status', op: 'in', values: ['submitted'] },
        { field: 'tag', op: 'in', values: ['tag-z'] },
      ],
      facts(),
    );
    expect(result.matched).toBe(false);
    expect(result.matched === false && result.reason).toContain('tag');
  });

  // --- OR groups: the Workiz "only one of these must be true" (25 imported rules)

  const sourceGroup: AutomationConditionGroup = {
    any: [
      { field: 'source', op: 'in', values: ['src-gmb'], labels: ['GMB'] },
      { field: 'source', op: 'in', values: ['src-1'], labels: ['Yelp'] },
      { field: 'source', op: 'in', values: ['src-fb'], labels: ['Facebook'] },
    ],
  };

  it('a group holds when one alternative does, and names every miss when none do', () => {
    expect(matchesConditionGroup(sourceGroup, facts()).matched).toBe(true);

    const missed = matchesConditionGroup(sourceGroup, facts({ sourceId: 'src-other' }));
    expect(missed.matched).toBe(false);
    expect(missed.matched === false && missed.reason).toContain('src-gmb');
    expect(missed.matched === false && missed.reason).toContain('src-fb');
  });

  it('an empty group holds for nothing — never for everything', () => {
    expect(matchesConditionGroup({ any: [] }, facts()).matched).toBe(false);
    expect(matchesConditions([{ any: [] }], facts()).matched).toBe(false);
  });

  it('the top level stays AND around a group, and a flat list is untouched', () => {
    const conditions: AutomationConditionNode[] = [{ field: 'status', op: 'in', values: ['submitted'] }, sourceGroup];
    expect(matchesConditions(conditions, facts()).matched).toBe(true);
    // The group holds, the flat condition next to it does not.
    expect(matchesConditions(conditions, facts({ superStatus: 'done' })).matched).toBe(false);
    // The flat condition holds, the group does not: still no firing.
    expect(matchesConditions(conditions, facts({ sourceId: 'src-other' })).matched).toBe(false);
  });

  it('a job that moves from one alternative to another is a new state to act on', () => {
    const conditions: AutomationConditionNode[] = [sourceGroup];
    const keyFor = (over: Partial<AutomationDealFacts>) =>
      occurrenceOf(statusEvent('done'), conditions, facts(over), 'deal.updated');

    expect(keyFor({})).toBe(keyFor({ tagIds: ['tag-z'] })); // a field the group never asked about
    expect(keyFor({})).not.toBe(keyFor({ sourceId: 'src-fb' })); // Yelp → Facebook
  });
});

describe('evaluateRule', () => {
  it('fires with an occurrence key and no delay', () => {
    const decision = evaluateRule({ id: 'r1', spec: spec() }, statusEvent('done'), facts(), NOW);
    expect(decision.fired).toBe(true);
    if (!decision.fired) return;
    expect(decision.entity).toBe('deal:d1');
    expect(decision.occurrence).toBe('status:submitted>done|>@2026-09-16T14:00:00.000Z');
    expect(decision.idempotencyKey).toBe('r1#deal:d1#status:submitted>done|>@2026-09-16T14:00:00.000Z');
    expect(decision.delayed).toBe(false);
    expect(decision.dueAt).toBe(NOW.toISOString());
  });

  it('a delay pushes dueAt out and marks the firing delayed', () => {
    const decision = evaluateRule(
      { id: 'r1', spec: spec({ timing: { delayMinutes: 1440 } }) },
      statusEvent('done'),
      facts(),
      NOW,
    );
    expect(decision.fired && decision.delayed).toBe(true);
    expect(decision.fired && decision.dueAt).toBe('2026-09-17T15:00:00.000Z');
  });

  it('refuses a rule without a spec or without actions', () => {
    expect(evaluateRule({ id: 'r1' }, statusEvent('done'), facts(), NOW)).toEqual({
      fired: false,
      reason: 'rule has no spec',
    });
    expect(
      evaluateRule({ id: 'r1', spec: spec({ actions: [] }) }, statusEvent('done'), facts(), NOW),
    ).toEqual({ fired: false, reason: 'rule has no actions' });
  });

  it('a timer only fires the rule it was armed for', () => {
    const timer: AutomationEvent = {
      kind: 'schedule.relative',
      at: NOW.toISOString(),
      dealId: 'd1',
      timer: { ruleId: 'other', anchorAt: '2026-09-20T13:00:00.000Z', offsetMinutes: -60 },
    };
    const relative = spec({ trigger: { kind: 'schedule.relative', anchor: 'scheduledStart', offsetMinutes: -60 } });
    expect(evaluateRule({ id: 'r1', spec: relative }, timer, facts(), NOW)).toEqual({
      fired: false,
      reason: 'timer belongs to another rule',
    });
  });

  it('a deal.updated rule fires once per state, not once per edit', () => {
    const tagRule = spec({
      trigger: { kind: 'deal.updated' },
      conditions: [
        { field: 'status', op: 'in', values: ['submitted'] },
        { field: 'tag', op: 'in', values: ['tag-a'] },
        { field: 'hasTechs', op: 'exists' },
      ],
    });
    const edit: AutomationEvent = { kind: 'deal.updated', at: NOW.toISOString(), dealId: 'd1' };
    const key = (over: Partial<AutomationDealFacts> = {}) => {
      const decision = evaluateRule({ id: 'r1', spec: tagRule }, edit, facts(over), NOW);
      return decision.fired ? decision.idempotencyKey : 'not fired';
    };
    const first = key();
    expect(
      evaluateRule({ id: 'r1', spec: tagRule }, { ...edit, at: '2026-09-16T16:00:00.000Z' }, facts(), NOW),
    ).toMatchObject({ idempotencyKey: first });

    // The rule matches for the same reason after an unrelated tag is added
    // or the roster changes, so it is the same firing — the techs it already
    // texted must not be texted again.
    expect(key({ tagIds: ['tag-a', 'tag-c'] })).toBe(first);
    expect(key({ tagIds: ['tag-b', 'tag-a'] })).toBe(first);
    expect(key({ assignedTechIds: ['t1', 't2', 't3'] })).toBe(first);

    // The state the rule fired for still separates one firing from another:
    // the job moving to another sub-status is a new occurrence.
    expect(key({ subStatusId: 'sub-other' })).not.toBe(first);
    // …and a job that stops matching stops firing.
    expect(key({ superStatus: 'in_progress' })).toBe('not fired');
    expect(key({ tagIds: ['tag-c'] })).toBe('not fired');
    expect(key({ assignedTechIds: [] })).toBe('not fired');
  });

  it('occurrence keys are derived from the event, never the clock', () => {
    const conditions = spec().conditions;
    const a = occurrenceOf(statusEvent('done'), conditions, facts(), 'deal.status_changed');
    const b = occurrenceOf(
      statusEvent('done', { at: '2026-09-16T23:59:00.000Z' }),
      conditions,
      facts(),
      'deal.status_changed',
    );
    expect(a).toBe(b);
    expect(occurrenceOf({ kind: 'deal.tech_assigned', at: NOW.toISOString(), techId: 't7' }, [], facts(), 'deal.tech_assigned')).toBe(
      'tech:t7',
    );
    expect(
      occurrenceOf(
        { kind: 'call.completed', at: NOW.toISOString(), call: { sid: 'CA9', outcome: 'missed' } },
        [],
        {},
        'call.completed',
      ),
    ).toBe('call:CA9');
  });
});
