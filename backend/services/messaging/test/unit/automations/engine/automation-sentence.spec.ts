import { automationDelayText, automationSentence, type AutomationSpec } from '@bitcrm/types';

/**
 * The Workiz "Automation Center" sentence ("When {p1} {p2} of {p7}, send
 * {p3} {p4} {p5}"), built in `@bitcrm/types` so the API, the settings page
 * and the firing log all read the same line.
 */
describe('automationSentence', () => {
  const labels = { 'sub-cancel': 'Canceled check', 'tag-sched': 'SCHEDULED', done: 'Done' };

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

  it('spells the delay in the largest whole unit', () => {
    expect(automationDelayText(undefined)).toBe('immediately');
    expect(automationDelayText(0)).toBe('immediately');
    expect(automationDelayText(30)).toBe('after 30 minutes');
    expect(automationDelayText(60)).toBe('after 1 hour');
    expect(automationDelayText(2880)).toBe('after 2 days');
    expect(automationDelayText(-60)).toBe('1 hour before');
  });
});
