import { automationSentence, type AutomationRule } from '@bitcrm/types';
import { TRANSLATOR_VERSION, translateWorkizRule } from '../../../../src/automations/translator/workiz-translator';
import { bitcrmId } from '../../../../src/automations/translator/workiz-ids';

const T0 = '2026-09-15T10:00:00.000Z';

/** A rule shaped exactly as the history loader stores it (`messages.py _automations`). */
const workizRule = (over: Partial<AutomationRule> = {}): AutomationRule => ({
  id: 'w1',
  name: 'Rule',
  enabled: false,
  source: 'workiz',
  entities: ['job'],
  category: 'custom',
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

const conditions = (...all: unknown[]) => ({
  all: [
    { fact: 'account_id', entity: 'account', operator: 'equal', value: '2774' },
    { fact: 'doctype', operator: 'equal', value: 'job' },
    { fact: 'is_deleted', operator: 'equal', value: '0' },
    { fact: 'is_lead', operator: 'equal', value: '0' },
    { fact: 'created_timestamp', operator: 'greaterThan', value: 1727704058.903 },
    ...all,
  ],
});

const notification = (over: Record<string, unknown> = {}) => ({
  type: 'notification',
  notify_medium: 'sms',
  receiverType: 'client',
  message_template: '<p>Hi {{first_name}}, job {{uuid}} at {{location_key}}</p>',
  time_interval: { value: 0, operator: null, time_field: null, time_unit: 'minutes' },
  working_hours: { dnd: false, from: '09:00', to: '17:00' },
  ...over,
});

describe('translateWorkizRule', () => {
  it('turns "a job has a status of <sub-status>, text the assigned tech" into a runnable spec', () => {
    // The "Canceled job & techs" rule: 5 411 firings, the busiest text in the account.
    const result = translateWorkizRule(
      workizRule({
        name: 'Canceled job & techs',
        conditions: conditions(
          { fact: 'tech_names', operator: 'notEqual', value: '' },
          {
            fact: 'sub_status_id',
            operator: 'equal',
            value: '15037',
            friendly_strings: { value: 'canceled check', fact: 'status' },
          },
        ),
        events: [notification({ receiverType: 'tech', working_hours: { dnd: true, from: '08:00', to: '17:00' } })],
      }),
    );

    expect(result.runnable).toBe(true);
    expect(result.spec?.trigger).toEqual({
      kind: 'deal.status_changed',
      toSubStatus: [bitcrmId('substatus', '15037')],
    });
    expect(result.spec?.conditions).toEqual([
      { field: 'isLead', op: 'eq', values: ['false'], labels: ['a job'] },
      { field: 'hasTechs', op: 'exists' },
      { field: 'subStatus', op: 'in', values: [bitcrmId('substatus', '15037')], labels: ['canceled check'] },
    ]);
    expect(result.spec?.actions).toEqual([
      { type: 'send_sms', to: 'assigned_techs', body: expect.stringContaining('{{job_id}}') },
    ]);
    expect(result.spec?.timing).toEqual({ workingHours: { from: '08:00', to: '17:00' }, quietHours: 'hold' });
    expect(automationSentence(result.spec!)).toBe(
      'When a job has a status of canceled check and it has a technician, send the assigned tech a text message immediately',
    );
  });

  it('reads a tag rule as "fires the first time the job matches"', () => {
    const result = translateWorkizRule(
      workizRule({
        name: 'Scheduled jobs',
        conditions: conditions(
          { fact: 'tech_names', operator: 'notEqual', value: '' },
          { fact: 'status', operator: 'equal', value: 'Submitted', friendly_strings: { value: 'submitted', fact: 'status' } },
          {
            fact: 'tags',
            entity: 'job',
            operator: 'contains',
            value: '718269',
            friendly_strings: { fact: 'job tag', value: 'SCHEDULED' },
          },
        ),
        events: [notification({ receiverType: 'tech' })],
      }),
    );

    expect(result.spec?.trigger).toEqual({ kind: 'deal.updated' });
    expect(result.spec?.conditions).toContainEqual({
      field: 'tag',
      op: 'in',
      values: [bitcrmId('tag', '718269')],
      labels: ['SCHEDULED'],
    });
    expect(result.notes.join(' ')).toContain('fires the first time the job matches');
  });

  it('reads "is created" as the creation trigger and the catalogs as conditions', () => {
    const result = translateWorkizRule(
      workizRule({
        name: 'Facebook Campaign - Key copy',
        conditions: conditions(
          { fact: 'status', operator: 'notIn', value: ['Done', 'Canceled'], friendly_strings: { value: 'is created', fact: 'status' } },
          { fact: 'adgroup_id', entity: 'job', operator: 'equal', value: '1530896', friendly_strings: { fact: 'source', value: 'Car Key Duplicates Form' } },
          { fact: 'job_type', entity: 'job', operator: 'equal', value: '13765', friendly_strings: { fact: 'job type', value: 'Car Key Copy ' } },
        ),
        events: [notification(), notification({ notify_medium: 'email', message_subject_template: 'Car key copy appointment' })],
      }),
    );

    expect(result.spec?.trigger).toEqual({ kind: 'deal.created' });
    expect(result.spec?.conditions).toContainEqual({
      field: 'source',
      op: 'in',
      values: [bitcrmId('adgroup', '1530896')],
      labels: ['Car Key Duplicates Form'],
    });
    expect(result.spec?.actions.map((a) => a.type)).toEqual(['send_sms', 'send_email']);
    expect(result.spec?.actions[1]).toMatchObject({ subject: 'Car key copy appointment' });
    expect(result.runnable).toBe(true);
  });

  it('carries a Workiz delay onto the rule', () => {
    const result = translateWorkizRule(
      workizRule({
        conditions: conditions({ fact: 'sub_status_id', operator: 'equal', value: '4585', friendly_strings: { value: 'no answer', fact: 'status' } }),
        events: [
          notification({
            time_interval: { value: 1, operator: 'after', time_field: 'status_changed_date_utc', time_unit: 'days' },
          }),
        ],
      }),
    );
    expect(result.spec?.timing?.delayMinutes).toBe(1440);
  });

  it('turns a job-date interval into a relative reminder', () => {
    const result = translateWorkizRule(
      workizRule({
        name: '1 Hour Notice / Client Reminder',
        conditions: conditions(),
        events: [
          notification({
            time_interval: { value: 1, operator: 'ahead', time_field: 'job_date_utc', time_unit: 'hours' },
          }),
        ],
      }),
    );
    expect(result.spec?.trigger).toEqual({ kind: 'schedule.relative', anchor: 'scheduledStart', offsetMinutes: -60 });
    expect(result.runnable).toBe(true);
  });

  it('maps a missed-call rule onto the call trigger', () => {
    const result = translateWorkizRule(
      workizRule({
        name: 'Missed call',
        entities: ['incoming_call'],
        category: 'phone',
        conditions: {
          all: [
            { fact: 'account_id', entity: 'account', operator: 'equal', value: '2774' },
            { fact: 'doctype', operator: 'equal', value: 'calls' },
            { fact: 'finalized', operator: 'equal', value: '1' },
            { fact: 'direction_business_logic', operator: 'equal', value: 'inbound' },
            { fact: 'voicemail_business_logic', operator: 'equal', value: '0' },
            { fact: 'blocked', operator: 'equal', value: '0' },
            { fact: 'dial_call_status', operator: 'in', value: ['no-answer', null], friendly_strings: { value: 'is missed', fact: 'status' } },
          ],
        },
        events: [notification()],
      }),
    );
    expect(result.spec?.trigger).toEqual({ kind: 'call.completed', callOutcome: 'missed', callDirection: 'inbound' });
    expect(result.runnable).toBe(true);
  });

  it('keeps a webhook rule and says the auth key was not carried', () => {
    const result = translateWorkizRule(
      workizRule({
        name: 'zelli_job_completed',
        conditions: conditions({ fact: 'status', operator: 'equal', value: 'Done' }),
        events: [
          {
            type: 'webhookPost',
            webhook_url: 'https://example.test/api/workiz-webhook',
            auth_key: 'zwh_secret',
            time_interval: { value: 0, operator: null, time_field: null, time_unit: 'minutes' },
          },
        ],
      }),
    );
    expect(result.spec?.actions).toEqual([{ type: 'webhook', url: 'https://example.test/api/workiz-webhook', method: 'POST' }]);
    expect(result.notes.join(' ')).toContain('auth key');
    expect(result.runnable).toBe(true);
  });

  it('addresses users and roles by their imported ids', () => {
    const result = translateWorkizRule(
      workizRule({
        conditions: conditions({ fact: 'status', operator: 'equal', value: 'Submitted' }),
        events: [notification({ receiverType: 'users', users_to: ['270795'] }), notification({ receiverType: 'role', roleId: '5' })],
      }),
    );
    expect(result.spec?.actions[0]).toMatchObject({ to: 'users', userIds: [bitcrmId('user', '270795')] });
    expect(result.spec?.actions[1]).toMatchObject({ to: 'role', roleIds: [bitcrmId('role', '5')] });
  });

  it('rewrites the Workiz short codes and reports the ones nothing resolves', () => {
    const result = translateWorkizRule(
      workizRule({
        conditions: conditions({ fact: 'status', operator: 'equal', value: 'Submitted' }),
        events: [notification({ message_template: '<p>{{uuid}} {{location_key}} {{jobDate}} {{booking_link}}</p>' })],
      }),
    );
    expect(result.spec?.actions[0].body).toBe('{{job_id}} {{full_address}} {{job_date}} {{booking_link}}');
    expect(result.notes.join(' ')).toContain('uuid → job_id');
    expect(result.notes.join(' ')).toContain('booking_link');
  });

  describe('what it refuses, and why', () => {
    const notRunnable = (rule: Partial<AutomationRule>) => translateWorkizRule(workizRule(rule));

    it('an entity BitCRM does not automate', () => {
      for (const [entity, match] of [
        ['invoice', /invoice/i],
        ['estimate', /estimate/i],
        ['lead', /lead entity/i],
        ['visit', /service-plan/i],
      ] as const) {
        const result = notRunnable({ entities: [entity], conditions: conditions(), events: [notification()] });
        expect(result.runnable).toBe(false);
        expect(result.notRunnableReason).toMatch(match);
      }
    });

    it('a condition on a fact BitCRM does not model — never quietly widened', () => {
      const result = notRunnable({
        conditions: conditions({
          fact: 'job_amount_due',
          entity: 'job',
          operator: 'equal',
          value: '0',
          friendly_strings: { fact: 'amount due' },
        }),
        events: [notification()],
      });
      expect(result.runnable).toBe(false);
      expect(result.notRunnableReason).toContain('amount due');
      expect(result.spec).toBeUndefined();
    });

    it('a rule whose only actions are email or in-app', () => {
      const result = notRunnable({
        conditions: conditions({ fact: 'status', operator: 'equal', value: 'Done' }),
        events: [notification({ notify_medium: 'email' })],
      });
      expect(result.runnable).toBe(false);
      expect(result.notRunnableReason).toMatch(/email/);
      expect(result.spec?.actions).toHaveLength(1); // still editable
    });

    it('a rule that creates a Workiz entity', () => {
      const result = notRunnable({
        conditions: conditions({ fact: 'status', operator: 'equal', value: 'Done' }),
        events: [{ type: 'createEntity' }],
      });
      expect(result.runnable).toBe(false);
      expect(result.notRunnableReason).toMatch(/creates a Workiz entity/);
    });
  });

  it('notes the account plumbing it dropped', () => {
    const result = translateWorkizRule(
      workizRule({ conditions: conditions({ fact: 'status', operator: 'equal', value: 'Done' }), events: [notification()] }),
    );
    expect(result.notes.join(' ')).toContain('account plumbing');
    expect(TRANSLATOR_VERSION).toBe(1);
  });
});
