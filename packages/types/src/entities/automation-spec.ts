/**
 * The typed half of an automation rule (Workiz "Automation Center", design
 * §10 M21 L): what fires it, what has to hold, and what it does. Stored on
 * `AutomationRule.spec` next to the imported Workiz shape — the imported
 * `trigger` / `conditions` / `events` stay untouched as data, the spec is
 * what the rule engine reads. A rule without a runnable spec is listed and
 * editable but cannot be switched on.
 */

export const AUTOMATION_TRIGGER_KINDS = [
  /** A job was created. */
  'deal.created',
  /** A job entered a super-status / sub-status (`to`, `toSubStatus`; a job created straight into it counts unless `onCreate: false`). */
  'deal.status_changed',
  /** A technician was added to the roster (once per technician). */
  'deal.tech_assigned',
  /** The job's date or time slot moved. */
  'deal.scheduled_changed',
  /**
   * Any change to the job (created, edited, status, roster, schedule): the
   * rule fires the first time its conditions hold for a given state — the
   * Workiz "when a job has a status of X [and tag Y]" semantics, where the
   * tag may be added after the status was reached.
   */
  'deal.updated',
  /** A call reached a terminal status (`callOutcome`, `callDirection`). */
  'call.completed',
  /** An inbound message was stored (`messageChannel`, `messagePartyKind`). */
  'message.received',
  /** A point in time relative to a job date (`anchor` ± `offsetMinutes`), armed by job events. */
  'schedule.relative',
] as const;
export type AutomationTriggerKind = (typeof AUTOMATION_TRIGGER_KINDS)[number];

export type AutomationCallOutcome = 'missed' | 'answered' | 'voicemail' | 'any';
export type AutomationScheduleAnchor = 'scheduledStart' | 'scheduledEnd' | 'statusChangedAt' | 'createdAt';

export interface AutomationTrigger {
  kind: AutomationTriggerKind;
  /** `deal.status_changed`: super-statuses entered; empty / absent = any. */
  to?: string[];
  /** `deal.status_changed`: super-statuses left. */
  from?: string[];
  /** `deal.status_changed`: sub-status ids entered. */
  toSubStatus?: string[];
  /** `deal.status_changed`: a job created straight into the status fires too (Workiz). Default `true`. */
  onCreate?: boolean;
  /** `call.completed`. Default `any`. */
  callOutcome?: AutomationCallOutcome;
  callDirection?: 'inbound' | 'outbound' | 'any';
  /** `message.received`. Default `any`. */
  messageChannel?: 'sms' | 'email' | 'in_app' | 'any';
  messagePartyKind?: 'contact' | 'company' | 'user' | 'none' | 'any';
  /** `schedule.relative`: the date the offset counts from. */
  anchor?: AutomationScheduleAnchor;
  /** `schedule.relative`: minutes after the anchor; negative = before (`-60` = one hour ahead). */
  offsetMinutes?: number;
}

export const AUTOMATION_CONDITION_FIELDS = [
  'status',
  'subStatus',
  'tag',
  'source',
  'jobType',
  'serviceArea',
  'isLead',
  'hasTechs',
  'tech',
  'dispatcher',
  'priority',
  'paymentStatus',
  'callDirection',
  'callStatus',
  'callAgent',
  'messageChannel',
  'messagePartyKind',
] as const;
export type AutomationConditionField = (typeof AUTOMATION_CONDITION_FIELDS)[number];

export const AUTOMATION_CONDITION_OPS = ['in', 'not_in', 'eq', 'ne', 'exists', 'not_exists'] as const;
export type AutomationConditionOp = (typeof AUTOMATION_CONDITION_OPS)[number];

export interface AutomationCondition {
  field: AutomationConditionField;
  op: AutomationConditionOp;
  /** Ids / enum values compared with the fact; `eq` / `ne` read the first. */
  values?: string[];
  /** Display names for `values`, same order — what the sentence and the editor show. */
  labels?: string[];
}

export const AUTOMATION_ACTION_TYPES = [
  'send_sms',
  'send_email',
  'send_in_app',
  'webhook',
  'add_tag',
  'change_sub_status',
] as const;
export type AutomationActionType = (typeof AUTOMATION_ACTION_TYPES)[number];

export const AUTOMATION_RECIPIENTS = ['client', 'assigned_techs', 'dispatcher', 'users', 'role', 'number'] as const;
export type AutomationRecipient = (typeof AUTOMATION_RECIPIENTS)[number];

export interface AutomationAction {
  type: AutomationActionType;
  /** Who a message goes to (`send_*`). */
  to?: AutomationRecipient;
  /** `to: users` — user ids. */
  userIds?: string[];
  /** `to: role` — every active user with one of these roles. */
  roleIds?: string[];
  /** `to: number` — an E.164 phone (SMS) … */
  number?: string;
  /** … or an email address (email). */
  email?: string;
  /** A stored message template, rendered for the job / recipient … */
  templateId?: string;
  /** … or an inline body with `{{short_codes}}` (wins over the template's body). */
  body?: string;
  subject?: string;
  /** `webhook` */
  url?: string;
  method?: 'POST' | 'PUT';
  headers?: Record<string, string>;
  /** `webhook`: JSON template (short codes allowed inside strings); default = the event and the job. */
  payload?: string;
  /** `add_tag` */
  tagId?: string;
  /** `change_sub_status` */
  superStatus?: string;
  subStatusId?: string;
}

export type AutomationQuietHoursMode = 'hold' | 'skip' | 'ignore';

export interface AutomationTiming {
  /** Wait this long after the trigger before acting (Workiz "N minutes / hours / days after"). */
  delayMinutes?: number;
  /**
   * What happens when the moment to act falls inside quiet hours:
   * `hold` (default) — act when they end; `skip` — do not act; `ignore` — act anyway.
   */
  quietHours?: AutomationQuietHoursMode;
  /** Rule-level window overriding the settings' quiet hours (Workiz per-rule "working hours"): act only between `from` and `to`. */
  workingHours?: { from: string; to: string };
}

export interface AutomationSpec {
  version: 1;
  trigger: AutomationTrigger;
  /** All must hold (AND). */
  conditions: AutomationCondition[];
  /** Run in order; one failing does not stop the next. */
  actions: AutomationAction[];
  timing?: AutomationTiming;
}

/** Where a rule's `spec` came from. */
export type AutomationSpecSource = 'builtin' | 'workiz-translator' | 'user';

// ---------------------------------------------------------------------------
// The rule sentence (Workiz "Automation Center" phrasing)
//
//   "When {p1} {p2} of {p7}, send {p3} {p4} {p5}"
//   → "When a job has a status of Canceled check, send the assigned tech
//      a text message immediately"
//
// Built here rather than in the service so the settings page, the API and
// the firing log all say the same thing. Ids are rendered through the
// `labels` map when one is supplied (`labels[id] = 'Canceled check'`);
// without it the sentence falls back to the spec's own `labels` array and
// then to the raw id.
// ---------------------------------------------------------------------------

const RECIPIENT_TEXT: Record<AutomationRecipient, string> = {
  client: 'the client',
  assigned_techs: 'the assigned tech',
  dispatcher: 'the dispatcher',
  users: 'selected users',
  role: 'a role',
  number: 'a number',
};

const MEDIUM_TEXT: Record<AutomationActionType, string> = {
  send_sms: 'a text message',
  send_email: 'an email',
  send_in_app: 'an in-app message',
  webhook: 'a webhook',
  add_tag: 'a tag',
  change_sub_status: 'a status',
};

const CONDITION_FIELD_TEXT: Record<AutomationConditionField, string> = {
  status: 'status',
  subStatus: 'status',
  tag: 'job tag',
  source: 'source',
  jobType: 'job type',
  serviceArea: 'service area',
  isLead: 'lead',
  hasTechs: 'technician',
  tech: 'technician',
  dispatcher: 'dispatcher',
  priority: 'priority',
  paymentStatus: 'payment status',
  callDirection: 'call direction',
  callStatus: 'call status',
  callAgent: 'agent',
  messageChannel: 'channel',
  messagePartyKind: 'sender',
};

/** Display names for the ids a spec holds, keyed by id. */
export type AutomationLabelMap = Record<string, string | undefined>;

/**
 * The names a spec carries about itself: every condition may bring
 * `labels` beside its `values` (what the Workiz rule called them, or what
 * the editor picked), so a sentence reads "Canceled check" rather than a
 * uuid even with no catalog loaded. A caller's own map wins over these.
 */
export function automationSpecLabels(spec: AutomationSpec): AutomationLabelMap {
  const out: AutomationLabelMap = {};
  for (const condition of spec.conditions ?? []) {
    (condition.values ?? []).forEach((value, i) => {
      const label = condition.labels?.[i] ?? (condition.values?.length === 1 ? condition.labels?.[0] : undefined);
      if (label && !out[value]) out[value] = label;
    });
  }
  return out;
}

const labelOf = (
  value: string,
  index: number,
  condition: AutomationCondition | undefined,
  labels: AutomationLabelMap | undefined,
): string => labels?.[value] ?? condition?.labels?.[index] ?? value;

const listOf = (
  values: string[] | undefined,
  condition: AutomationCondition | undefined,
  labels: AutomationLabelMap | undefined,
): string => {
  const names = (values ?? []).map((v, i) => labelOf(v, i, condition, labels));
  if (names.length === 0) return 'any';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
};

/** "immediately" / "after 30 minutes" / "after 1 day". */
export function automationDelayText(minutes: number | undefined): string {
  if (!minutes) return 'immediately';
  const abs = Math.abs(minutes);
  const [n, unit] =
    abs % 1440 === 0 ? [abs / 1440, 'day'] : abs % 60 === 0 ? [abs / 60, 'hour'] : [abs, 'minute'];
  const plural = `${n} ${unit}${n === 1 ? '' : 's'}`;
  return minutes < 0 ? `${plural} before` : `after ${plural}`;
}

/** The "When …" half of the sentence. */
export function automationTriggerSentence(spec: AutomationSpec, labels?: AutomationLabelMap): string {
  const t = spec.trigger;
  const statusCondition = spec.conditions.find((c) => c.field === 'status' || c.field === 'subStatus');
  const negated = statusCondition?.op === 'not_in' || statusCondition?.op === 'ne';
  switch (t.kind) {
    case 'deal.created':
      return 'When a job is created';
    case 'deal.status_changed': {
      const entered = t.toSubStatus?.length ? t.toSubStatus : t.to;
      const from = t.from?.length ? ` from ${listOf(t.from, undefined, labels)}` : '';
      return `When a job has a status of ${listOf(entered, undefined, labels)}${from}`;
    }
    case 'deal.tech_assigned':
      return 'When a technician is assigned to a job';
    case 'deal.scheduled_changed':
      return 'When a job is rescheduled';
    case 'deal.updated':
      if (!statusCondition) return 'When a job changes';
      return negated
        ? `When a job does not have a status of ${listOf(statusCondition.values, statusCondition, labels)}`
        : `When a job has a status of ${listOf(statusCondition.values, statusCondition, labels)}`;
    case 'call.completed': {
      const outcome =
        t.callOutcome === 'missed'
          ? 'is missed'
          : t.callOutcome === 'answered'
            ? 'is answered'
            : t.callOutcome === 'voicemail'
              ? 'goes to voicemail'
              : 'ends';
      return `When a call ${outcome}`;
    }
    case 'message.received':
      return 'When a message is received';
    case 'schedule.relative': {
      const anchor =
        t.anchor === 'scheduledEnd'
          ? "the job's end"
          : t.anchor === 'statusChangedAt'
            ? 'the last status change'
            : t.anchor === 'createdAt'
              ? 'the job being created'
              : "the job's start";
      const offset = t.offsetMinutes ?? 0;
      if (offset === 0) return `When it is ${anchor}`;
      return `When it is ${automationDelayText(offset)} ${anchor}`;
    }
    default:
      return 'When a job changes';
  }
}

/** The ", and …" half — the conditions the trigger does not already say. */
export function automationConditionsSentence(spec: AutomationSpec, labels?: AutomationLabelMap): string {
  // `isLead` is always true here (BitCRM has no separate lead entity), so it
  // is never worth a clause; the status is already in the trigger's half.
  const saidByTrigger =
    spec.trigger.kind === 'deal.updated' || spec.trigger.kind === 'deal.status_changed'
      ? new Set(['status', 'subStatus', 'isLead'])
      : new Set(['isLead']);
  const parts = spec.conditions
    .filter((c) => !saidByTrigger.has(c.field))
    .map((c) => {
      const field = CONDITION_FIELD_TEXT[c.field] ?? c.field;
      switch (c.op) {
        case 'exists':
          return `it has a ${field}`;
        case 'not_exists':
          return `it has no ${field}`;
        case 'not_in':
        case 'ne':
          return `its ${field} is not ${listOf(c.values, c, labels)}`;
        default:
          return `its ${field} is ${listOf(c.values, c, labels)}`;
      }
    });
  return parts.length ? ` and ${parts.join(', and ')}` : '';
}

/** The ", send …" half, one clause per action (the timing is said once, at the end). */
export function automationActionSentence(action: AutomationAction, labels?: AutomationLabelMap): string {
  switch (action.type) {
    case 'send_sms':
    case 'send_email':
    case 'send_in_app': {
      const to =
        action.to === 'number'
          ? (action.number ?? action.email ?? 'a number')
          : RECIPIENT_TEXT[action.to ?? 'client'];
      return `send ${to} ${MEDIUM_TEXT[action.type]}`;
    }
    case 'webhook':
      return `post a webhook to ${action.url ?? 'a URL'}`;
    case 'add_tag':
      return `add the tag ${labels?.[action.tagId ?? ''] ?? action.tagId ?? ''}`.trim();
    case 'change_sub_status':
      return `set the status to ${labels?.[action.subStatusId ?? ''] ?? action.subStatusId ?? action.superStatus ?? ''}`.trim();
    default:
      return 'do nothing';
  }
}

/**
 * The whole rule as one Workiz-style sentence. The delay is said once, at
 * the end, because Workiz keeps it on the action ("immediately", "after 1
 * day") and every action of a rule shares the rule's timing here.
 */
export function automationSentence(spec: AutomationSpec, labels?: AutomationLabelMap): string {
  const named: AutomationLabelMap = { ...automationSpecLabels(spec), ...(labels ?? {}) };
  const actions = spec.actions.length
    ? spec.actions.map((a) => automationActionSentence(a, named)).join(', and ')
    : 'do nothing';
  const delay = automationDelayText(spec.timing?.delayMinutes);
  const tail = delay === 'immediately' ? 'immediately' : delay;
  return `${automationTriggerSentence(spec, named)}${automationConditionsSentence(spec, named)}, ${actions} ${tail}`.replace(
    /\s+/g,
    ' ',
  );
}

/** One firing of a rule (`AUTORUN#` items, TTL). */
export type AutomationRunOutcome = 'sent' | 'partial' | 'skipped' | 'failed' | 'scheduled' | 'dry_run' | 'duplicate';

export interface AutomationRunAction {
  type: AutomationActionType;
  to?: string;
  outcome: string;
  messageId?: string;
  conversationId?: string;
  statusCode?: number;
  error?: string;
  /** What was (or would be) sent, for the test run and the log. */
  body?: string;
}

export interface AutomationRun {
  id: string;
  ruleId: string;
  firedAt: string;
  trigger: string;
  /** `deal:<id>`, `call:<sid>`, `message:<id>`. */
  entity: string;
  dealId?: string;
  occurrence: string;
  outcome: AutomationRunOutcome;
  actions: AutomationRunAction[];
  /** Why nothing was done (`skipped`), or the error (`failed`). */
  reason?: string;
  /** When a delayed / held firing will run (`scheduled`). */
  dueAt?: string;
  expiresAt?: number;
}
