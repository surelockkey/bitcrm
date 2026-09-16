import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { automationSentence, type AutomationRule } from '@bitcrm/types';
import { translateWorkizRule } from '../../../../src/automations/translator/workiz-translator';

/**
 * The translator against real exported rules.
 *
 * `test/fixtures/workiz-automations/` holds fourteen rules copied from
 * `workiz-data-parser/data/raw/settings_automations/` with the content
 * masked (phone numbers, emails, URLs, the webhook auth key, the business
 * name) and the structure — conditions, events, trigger, time intervals,
 * working hours — untouched. They are the shapes the 80 imported rules
 * come in: a sub-status rule, a tag rule, a "job is created" rule, a
 * delayed follow-up, a webhook, two call rules, a job-date reminder, and
 * the four kinds the engine cannot run (invoice, lead, service-plan visit,
 * a condition on the job balance).
 */
const FIXTURES = join(__dirname, '../../../fixtures/workiz-automations');

interface FixtureIndexRow {
  file: string;
  name: string;
  entities: string[];
  workizEnabled: boolean;
  workizTriggered: number;
}

const index = JSON.parse(readFileSync(join(FIXTURES, 'index.json'), 'utf8')) as FixtureIndexRow[];

/** The row the history loader writes for one exported rule (`messages.py _automations`). */
function asStoredRule(file: string): AutomationRule {
  const raw = JSON.parse(readFileSync(join(FIXTURES, file), 'utf8')) as Record<string, any>;
  return {
    id: String(raw._id),
    name: String(raw.name),
    enabled: false,
    category: raw.category,
    entities: raw.entities,
    notifyMedium: raw.notifyMedium,
    trigger: raw.trigger ?? undefined,
    conditions: raw.conditions ?? undefined,
    actions: raw.actions ?? undefined,
    events: raw.events ?? undefined,
    ruleSentence: raw.ruleSentence ?? undefined,
    parameters: raw.parameters ?? undefined,
    workizEnabled: !!raw.enabled,
    workizTriggered: raw.triggered,
    source: 'workiz',
    externalId: `workiz:automation:${raw._id}`,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

const translated = new Map(index.map((row) => [row.file, translateWorkizRule(asStoredRule(row.file))]));
const of = (file: string) => translated.get(file)!;

describe('the translator against real exported rules', () => {
  it('reads every fixture without throwing, and leaves the imported shape alone', () => {
    expect(index).toHaveLength(14);
    for (const row of index) {
      const result = of(row.file);
      expect(typeof result.runnable).toBe('boolean');
      if (result.runnable) expect(result.spec?.actions.length).toBeGreaterThan(0);
      else expect(result.notRunnableReason).toBeTruthy();
    }
  });

  it('runs the rules that carried the account (the coverage table)', () => {
    const coverage = index.map((row) => ({
      name: row.name,
      on: row.workizEnabled,
      runnable: of(row.file).runnable,
      trigger: of(row.file).spec?.trigger.kind,
    }));

    expect(coverage).toEqual([
      { name: 'Canceled job & techs', on: true, runnable: true, trigger: 'deal.status_changed' },
      { name: 'Scheduled jobs', on: true, runnable: true, trigger: 'deal.updated' },
      { name: 'Missed call - n/a', on: true, runnable: true, trigger: 'deal.status_changed' },
      { name: 'OOA JOBS', on: true, runnable: true, trigger: 'deal.status_changed' },
      { name: 'Facebook Campaign - Key copy', on: true, runnable: true, trigger: 'deal.created' },
      { name: 'Facebook Campaign - Copy & Follow-up', on: true, runnable: true, trigger: 'deal.status_changed' },
      { name: 'zelli_job_completed', on: true, runnable: true, trigger: 'deal.status_changed' },
      { name: 'Missed call Immediately / Text', on: false, runnable: true, trigger: 'call.completed' },
      { name: 'Voicemail call Immediately / Text', on: false, runnable: true, trigger: 'call.completed' },
      { name: '1 Hour Notice / Client Reminder', on: false, runnable: false, trigger: undefined },
      { name: 'Invoice due 7 days / Email', on: false, runnable: false, trigger: undefined },
      { name: 'Lead follow up', on: false, runnable: false, trigger: undefined },
      { name: 'Oil Change', on: true, runnable: false, trigger: undefined },
      { name: 'NY Bronx Review request text to client', on: false, runnable: false, trigger: undefined },
    ]);

    // Nine of the fourteen run; every rule that was on in Workiz except the
    // service-plan visit, which BitCRM has no equivalent for.
    expect(coverage.filter((r) => r.runnable)).toHaveLength(9);
    const enabled = coverage.filter((r) => r.on);
    expect(enabled.filter((r) => r.runnable)).toHaveLength(enabled.length - 1);
  });

  it('says each runnable rule the way Workiz said it', () => {
    expect(automationSentence(of('canceled-job-and-techs.json').spec!)).toBe(
      'When a job has a status of canceled check and it has a technician, send the assigned tech a text message immediately',
    );
    expect(automationSentence(of('scheduled-jobs.json').spec!)).toBe(
      'When a job has a status of Submitted and it has a technician, and its job tag is SCHEDULED, send the assigned tech a text message immediately',
    );
    expect(automationSentence(of('facebook-key-copy-followup.json').spec!)).toBe(
      'When a job has a status of no answer and its source is Car Key Duplicates Form, and its job type is Car Key Copy, send the client a text message, and send the client an email after 1 day',
    );
    expect(automationSentence(of('missed-call-immediate-text.json').spec!)).toBe(
      'When a call is missed, send the client a text message immediately',
    );
    expect(automationSentence(of('zelli-job-completed.json').spec!)).toBe(
      'When a job has a status of job done and its source is ZELLI, post a webhook to https://example.test/api/webhook immediately',
    );
  });

  it('never fires more broadly than Workiz did: an "is created" rule keeps its exclusion', () => {
    // The Workiz rule reads `status notIn [Done, Canceled]` under the
    // friendly name "is created"; dropping that would text a job created
    // straight into Done or Canceled.
    const created = of('facebook-key-copy.json').spec!;
    expect(created.trigger).toEqual({ kind: 'deal.created' });
    expect(created.conditions).toContainEqual({
      field: 'status',
      op: 'not_in',
      values: ['done', 'canceled'],
      labels: ['Done', 'Canceled'],
    });
  });

  it('keeps the message the rule sent, with the short codes it can fill', () => {
    const canceled = of('canceled-job-and-techs.json').spec!.actions[0];
    expect(canceled.body).toContain('CLIENT CANCELED');
    expect(canceled.body).toContain('{{job_id}}'); // was {{uuid}}
    expect(canceled.body).toContain('{{full_address}}'); // was {{location_key}}
    expect(canceled.body).not.toContain('{{uuid}}');
  });

  it('carries the delay and the quiet-hours behaviour Workiz had', () => {
    expect(of('facebook-key-copy-followup.json').spec?.timing?.delayMinutes).toBe(1440);
    // "Canceled job & techs" ran with DND on, 08:00–17:00.
    expect(of('canceled-job-and-techs.json').spec?.timing).toEqual({
      workingHours: { from: '08:00', to: '17:00' },
      quietHours: 'hold',
    });
    // "Scheduled jobs" also ran with DND on, 08:00–18:00.
    expect(of('scheduled-jobs.json').spec?.timing?.workingHours).toEqual({ from: '08:00', to: '18:00' });
    // The Facebook rules had DND off: Workiz sent them at any hour.
    expect(of('facebook-key-copy.json').spec?.timing?.quietHours).toBe('ignore');
  });

  it('names the reason for every rule it will not run', () => {
    expect(of('invoice-due-7-days-email.json').notRunnableReason).toMatch(/invoice/i);
    expect(of('lead-follow-up.json').notRunnableReason).toMatch(/lead entity/i);
    expect(of('oil-change-visit.json').notRunnableReason).toMatch(/service-plan/i);
    expect(of('bronx-review-request.json').notRunnableReason).toMatch(/amount due|balance/i);
    expect(of('one-hour-notice.json').notRunnableReason).toMatch(/schedule type/i);
  });

  it('addresses the right people', () => {
    expect(of('canceled-job-and-techs.json').spec?.actions[0].to).toBe('assigned_techs');
    expect(of('missed-call-na.json').spec?.actions[0].to).toBe('client');
    const ooa = of('ooa-jobs.json').spec!;
    expect(ooa.actions.map((a) => `${a.type}:${a.to}`)).toEqual(['send_email:users', 'send_sms:users']);
    expect(ooa.actions[0].userIds).toHaveLength(1);
    expect(ooa.actions[0].userIds?.[0]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps the webhook secret out of the spec', () => {
    const webhook = of('zelli-job-completed.json').spec!.actions[0];
    expect(webhook).toEqual({ type: 'webhook', url: 'https://example.test/api/webhook', method: 'POST' });
    expect(JSON.stringify(webhook)).not.toContain('auth');
  });

  it('every fixture is masked — no real phone, email, host or key', () => {
    for (const file of readdirSync(FIXTURES)) {
      const text = readFileSync(join(FIXTURES, file), 'utf8');
      expect(text).not.toMatch(/surelockkey|slk\.services|zwh_/i);
      expect(text).not.toMatch(/\b(?!555)\d{3}[-.]\d{3}[-.]\d{4}\b/);
    }
  });
});
