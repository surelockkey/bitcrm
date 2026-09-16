import { BUILTIN_AUTOMATION_RULE_IDS, type AutomationRule, type BuiltinAutomationRuleId } from '@bitcrm/types';

/** Timestamp the built-in rules report until somebody edits them (nothing is seeded). */
export const BUILTIN_RULES_SINCE = '2026-09-15T00:00:00.000Z';

/**
 * The rules this service executes (design §10 M21 minimum). They exist in
 * code, not in the table: `AutomationsService` lays a stored row over the
 * default, and the first `PATCH` writes the row. Enabled by default — that
 * is the Workiz behaviour the cut-over must keep (`sms_format` dispatch
 * texts, `on_my_way_msg_notify` / `late_msg_notify` = "1").
 */
export const BUILTIN_RULES: Record<BuiltinAutomationRuleId, AutomationRule> = {
  'new-job-sms': {
    id: 'new-job-sms',
    name: 'New job SMS to technician',
    enabled: true,
    builtin: true,
    description:
      'Texts the settings `smsFormat` template (Workiz `sms_format`, "New job #…") to the personal phone of ' +
      'each technician when they are assigned to a job, and again when the job is moved to another date. ' +
      'Held during quiet hours; skipped for opted-out or phone-less technicians.',
    category: 'job',
    entities: ['job'],
    notifyMedium: 'sms',
    trigger: { events: ['deal.tech_assigned', 'deal.updated'] },
    source: 'bitcrm',
    createdAt: BUILTIN_RULES_SINCE,
    updatedAt: BUILTIN_RULES_SINCE,
  },
  'on-my-way': {
    id: 'on-my-way',
    name: 'On my way (technician → client)',
    enabled: true,
    builtin: true,
    description:
      'A technician on the job taps "On my way": the settings `onMyWayMsg` text is rendered for the client ' +
      'and sent to the job conversation. Also gated by settings `onMyWayMsgNotify`.',
    category: 'job',
    entities: ['job'],
    notifyMedium: 'sms',
    trigger: { manual: 'POST /api/messaging/automations/on-my-way' },
    source: 'bitcrm',
    createdAt: BUILTIN_RULES_SINCE,
    updatedAt: BUILTIN_RULES_SINCE,
  },
  late: {
    id: 'late',
    name: 'Running late (technician → client)',
    enabled: true,
    builtin: true,
    description:
      'A technician on the job reports a delay: the settings `lateMsg` text is rendered with `{{late_value}}` ' +
      'and sent to the job conversation. Also gated by settings `lateMsgNotify`.',
    category: 'job',
    entities: ['job'],
    notifyMedium: 'sms',
    trigger: { manual: 'POST /api/messaging/automations/late' },
    source: 'bitcrm',
    createdAt: BUILTIN_RULES_SINCE,
    updatedAt: BUILTIN_RULES_SINCE,
  },
};

export const isBuiltinRuleId = (id: string): id is BuiltinAutomationRuleId =>
  (BUILTIN_AUTOMATION_RULE_IDS as readonly string[]).includes(id);
