import { automationDelayText, automationSentence, type AutomationSpec } from '@bitcrm/types';

/**
 * The Workiz "Automation Center" sentence ("When {p1} {p2} of {p7}, send
 * {p3} {p4} {p5}"), built in `@bitcrm/types` so the API, the settings page
 * and the firing log all read the same line.
 */
describe('automationSentence', () => {
  const labels = {
    'sub-cancel': 'Canceled check',
    'sub-done': 'Paid in full',
    'tag-sched': 'SCHEDULED',
    done: 'Done',
    submitted: 'Submitted',
    canceled: 'Canceled',
  };

  it('says a status rule the way Workiz says it', () => {
    const spec: AutomationSpec = {
      version: 1,
      trigger: { kind: 'deal.status_changed', toSubStatus: ['sub-cancel'] },
      conditions: [{ field: 'hasTechs', op: 'exists' }],
      actions: [{ type: 'send_sms', to: 'assigned_techs', body: 'CLIENT CANCELED' }],
    };
    expect(automationSentence(spec, labels)).toBe(
      'When a job has a status of Canceled check and it has a technician, send the assigned tech a text message immediately',
    );
  });

  it('says a status rule that names no status as the change it fires on', () => {
    // A rule with an empty `to` fires on every status change. "a status of
    // any" reads like a slot nobody filled in — and a rule that reads as
    // half-written is one somebody switches off.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.status_changed' },
          conditions: [],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe("When a job's status changes, send the client a text message immediately");

    // The status it left is still worth saying, even with none named to enter.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.status_changed', from: ['done'] },
          conditions: [],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe("When a job's status changes from Done, send the client a text message immediately");
  });

  it('keeps the status condition when the trigger names no status to say it for', () => {
    // The status condition is normally left out because the trigger's half
    // already says it. A trigger that names none says nothing to leave out,
    // and a rule narrowed only by that condition would otherwise read as
    // firing on every status change — finished-looking and false.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.status_changed' },
          conditions: [{ field: 'status', op: 'in', values: ['done'] }],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe("When a job's status changes and its status is Done, send the client a text message immediately");

    // A trigger that does name one goes on saying it exactly once.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.status_changed', to: ['done'] },
          conditions: [{ field: 'status', op: 'in', values: ['done'] }],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe('When a job has a status of Done, send the client a text message immediately');
  });

  it('says the sub-status beside the status the trigger named, not instead of it', () => {
    // "Job matches" is a trigger the editor offers and "Sub-status" a field it
    // offers, so this rule is buildable here today. The trigger's half names
    // the super-status; the sub-status is the rest of what the rule narrows on
    // and nothing else says it.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.status_changed', to: ['done'] },
          conditions: [{ field: 'subStatus', op: 'in', values: ['sub-cancel'] }],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe(
      'When a job has a status of Done and its sub-status is Canceled check, send the client a text message immediately',
    );

    // `deal.updated` borrows the first status-family condition for its half;
    // the second one is not the borrowed one and has to be said.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.updated' },
          conditions: [
            { field: 'status', op: 'in', values: ['done'] },
            { field: 'subStatus', op: 'in', values: ['sub-cancel'] },
          ],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe(
      'When a job has a status of Done and its sub-status is Canceled check, send the client a text message immediately',
    );
  });

  it('leaves out the one status condition the trigger echoed, not every status condition', () => {
    // Two status conditions, one of them the trigger's own words. Dropping the
    // family drops the exclusion with it, and the sentence then reads whole
    // while the rule quietly refuses every canceled job.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.status_changed', to: ['done'] },
          conditions: [
            { field: 'status', op: 'in', values: ['done'] },
            { field: 'status', op: 'not_in', values: ['canceled'], labels: ['Canceled'] },
          ],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe(
      'When a job has a status of Done and its status is not Canceled, send the client a text message immediately',
    );
  });

  it('says nothing twice about a super-status a named sub-status has already fixed', () => {
    // A sub-status is filed under exactly one super-status
    // (`DealSubStatus.group`), so a trigger that names the sub-status has
    // named the super-status with it. This is the shape two of the imported
    // Workiz rules come in — a sub-status trigger plus the `status notEqual
    // Canceled` Workiz adds itself and never shows — and it reads as one
    // status, which is what it is.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.status_changed', toSubStatus: ['sub-cancel'] },
          conditions: [
            { field: 'status', op: 'not_in', values: ['canceled'], labels: ['Canceled'] },
            { field: 'subStatus', op: 'in', values: ['sub-cancel'] },
            { field: 'tag', op: 'in', values: ['tag-sched'] },
          ],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe(
      'When a job has a status of Canceled check and its job tag is SCHEDULED, send the client a text message immediately',
    );
  });

  it('treats the trigger\'s list and the condition\'s as the same list whatever order they are in', () => {
    // `in` asks whether the status is one of these, so two pickers that were
    // filled in from opposite ends wrote the same condition. Comparing them
    // in order makes the sentence say it twice, and the second time reads as
    // a second narrowing that is not there.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.status_changed', to: ['done', 'submitted'] },
          conditions: [{ field: 'status', op: 'in', values: ['submitted', 'done'] }],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe('When a job has a status of Done or Submitted, send the client a text message immediately');
  });

  it('keeps a status condition the trigger\'s sub-statuses do not pin down', () => {
    // Two sub-statuses, and the trigger names both super-statuses they are
    // filed under, so "it entered one of these sub-statuses" leaves the job's
    // super-status open — and `status is Done` is then half of what the rule
    // narrows on, not a restatement of the trigger.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: {
            kind: 'deal.status_changed',
            to: ['done', 'canceled'],
            toSubStatus: ['sub-done', 'sub-cancel'],
          },
          conditions: [
            { field: 'subStatus', op: 'in', values: ['sub-done', 'sub-cancel'] },
            { field: 'status', op: 'in', values: ['done'] },
          ],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe(
      'When a job has a status of Paid in full or Canceled check and its status is Done, send the client a text message immediately',
    );
  });

  it('reads a `deal.updated` rule the same way whichever order its conditions are in', () => {
    // The trigger has no status of its own and borrows one, so which
    // condition it borrows decides both halves of the sentence. It borrows
    // the super-status where there is one: that is the phrase the half is
    // written in ("has a status of"), and it leaves the sub-status to be said
    // as the extra narrowing it is — whether the editor happened to add it
    // above or below.
    const said =
      'When a job has a status of Done and its sub-status is Canceled check, send the client a text message immediately';
    for (const conditions of [
      [
        { field: 'status', op: 'in', values: ['done'] },
        { field: 'subStatus', op: 'in', values: ['sub-cancel'] },
      ],
      [
        { field: 'subStatus', op: 'in', values: ['sub-cancel'] },
        { field: 'status', op: 'in', values: ['done'] },
      ],
    ] as AutomationSpec['conditions'][]) {
      expect(
        automationSentence(
          { version: 1, trigger: { kind: 'deal.updated' }, conditions, actions: [{ type: 'send_sms', to: 'client' }] },
          labels,
        ),
      ).toBe(said);
    }

    // A sub-status the rule *excludes* fixes no super-status at all, so the
    // status beside it is the only thing saying which jobs this rule is for.
    expect(
      automationSentence(
        {
          version: 1,
          trigger: { kind: 'deal.updated' },
          conditions: [
            { field: 'subStatus', op: 'not_in', values: ['sub-cancel'] },
            { field: 'status', op: 'in', values: ['done'] },
          ],
          actions: [{ type: 'send_sms', to: 'client' }],
        },
        labels,
      ),
    ).toBe(
      'When a job has a status of Done and its sub-status is not Canceled check, send the client a text message immediately',
    );
  });

  it('says a tag rule through its conditions', () => {
    const spec: AutomationSpec = {
      version: 1,
      trigger: { kind: 'deal.updated' },
      conditions: [
        { field: 'status', op: 'in', values: ['submitted'], labels: ['Submitted'] },
        { field: 'tag', op: 'in', values: ['tag-sched'] },
      ],
      actions: [{ type: 'send_sms', to: 'assigned_techs' }],
    };
    expect(automationSentence(spec, labels)).toBe(
      'When a job has a status of Submitted and its job tag is SCHEDULED, send the assigned tech a text message immediately',
    );
  });

  it('says the delay and the follow-up wording', () => {
    const spec: AutomationSpec = {
      version: 1,
      trigger: { kind: 'deal.created' },
      conditions: [],
      actions: [{ type: 'send_sms', to: 'client' }],
      timing: { delayMinutes: 1440 },
    };
    expect(automationSentence(spec)).toBe('When a job is created, send the client a text message after 1 day');
  });

  it('says a relative reminder and a webhook', () => {
    expect(
      automationSentence({
        version: 1,
        trigger: { kind: 'schedule.relative', anchor: 'scheduledStart', offsetMinutes: -60 },
        conditions: [],
        actions: [{ type: 'send_sms', to: 'client' }],
      }),
    ).toBe("When it is 1 hour before the job's start, send the client a text message immediately");

    expect(
      automationSentence({
        version: 1,
        trigger: { kind: 'deal.status_changed', to: ['done'] },
        conditions: [],
        actions: [{ type: 'webhook', url: 'https://example.test/hook' }],
      }),
    ).toBe('When a job has a status of done, post a webhook to https://example.test/hook immediately');
  });

  it('says a call rule', () => {
    expect(
      automationSentence({
        version: 1,
        trigger: { kind: 'call.completed', callOutcome: 'missed', callDirection: 'inbound' },
        conditions: [],
        actions: [{ type: 'send_sms', to: 'client' }],
      }),
    ).toBe('When a call is missed, send the client a text message immediately');
  });

  it('says an OR group as one list of the field it narrows', () => {
    const spec: AutomationSpec = {
      version: 1,
      trigger: { kind: 'deal.status_changed', to: ['done'] },
      conditions: [
        {
          any: [
            { field: 'source', op: 'in', values: ['src-yelp'], labels: ['Yelp'] },
            { field: 'source', op: 'in', values: ['src-gmb'], labels: ['GMB'] },
            { field: 'source', op: 'in', values: ['src-fb'], labels: ['Facebook'] },
          ],
        },
      ],
      actions: [{ type: 'send_sms', to: 'client' }],
    };
    expect(automationSentence(spec, labels)).toBe(
      'When a job has a status of Done and its source is one of Yelp, GMB or Facebook, ' +
        'send the client a text message immediately',
    );
  });

  it('spells out a mixed group, and reads a group of one as a plain condition', () => {
    const of = (conditions: AutomationSpec['conditions']) =>
      automationSentence({
        version: 1,
        trigger: { kind: 'deal.created' },
        conditions,
        actions: [{ type: 'send_sms', to: 'client' }],
      });

    expect(of([{ any: [{ field: 'tag', op: 'in', values: ['tag-sched'], labels: ['SCHEDULED'] }] }])).toBe(
      'When a job is created and its job tag is SCHEDULED, send the client a text message immediately',
    );
    expect(
      of([
        {
          any: [
            { field: 'tag', op: 'in', values: ['tag-sched'], labels: ['SCHEDULED'] },
            { field: 'hasTechs', op: 'not_exists' },
          ],
        },
      ]),
    ).toBe(
      'When a job is created and its job tag is SCHEDULED or it has no technician, ' +
        'send the client a text message immediately',
    );
  });

  it('a spec with no conditions at all still reads (they are optional now)', () => {
    expect(
      automationSentence({
        version: 1,
        trigger: { kind: 'deal.created' },
        actions: [{ type: 'send_sms', to: 'client' }],
      }),
    ).toBe('When a job is created, send the client a text message immediately');
  });

  it('spells the delay in the largest whole unit', () => {
    expect(automationDelayText(undefined)).toBe('immediately');
    expect(automationDelayText(0)).toBe('immediately');
    expect(automationDelayText(30)).toBe('after 30 minutes');
    expect(automationDelayText(60)).toBe('after 1 hour');
    expect(automationDelayText(2880)).toBe('after 2 days');
    expect(automationDelayText(-60)).toBe('1 hour before');
  });
});
