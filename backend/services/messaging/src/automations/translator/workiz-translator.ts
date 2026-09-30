import {
  type AutomationAction,
  type AutomationCondition,
  type AutomationConditionNode,
  type AutomationRule,
  type AutomationSpec,
  type AutomationTrigger,
} from '@bitcrm/types';
import { htmlToText, looksLikeHtml } from '../../templates/html-text';
import { NOTHING_EXECUTABLE_REASON, hasExecutableAction } from '../automations.constants';
import { bitcrmId } from './workiz-ids';
import { rewriteShortCodes } from './workiz-short-codes';

/**
 * The 80 imported Workiz rules onto the typed model.
 *
 * A Workiz rule is a `conditions.all` list of facts plus an `events` list
 * of things to do; which of those facts is "the trigger" is only visible in
 * `friendly_strings` / `trigger.parameters` ("has a status of", "is
 * missed"). The translation therefore reads the conditions, lifts the one
 * that names the trigger, keeps the rest as conditions, and maps Workiz's
 * numeric ids to the uuids the importer minted for the same rows
 * (`workiz-ids.ts`).
 *
 * Two principles:
 *
 *   • Never fire more broadly than Workiz did. A condition on a fact
 *     BitCRM does not model (an invoice balance, a call flow) makes the
 *     rule NOT runnable with that fact named — it is not quietly dropped.
 *     Only account plumbing (`account_id`, `doctype`, `is_deleted`, the
 *     export timestamp) is dropped, and said so in the notes.
 *   • Never claim to do something the engine cannot. A rule whose only
 *     actions are email or in-app is not runnable yet, because the system
 *     send path is SMS-only.
 *
 * The result is advisory: it is computed at read time and only written to
 * the table by `POST /automations/migrate`, so re-running a better
 * translator needs no data migration — as long as `TRANSLATOR_VERSION`
 * moves with it, which is what tells an already-migrated row to be read
 * again.
 */

/**
 * Bump this whenever the translation of the same Workiz rule changes.
 * A row `migrate()` has already written carries the version it was written
 * at, and both `withSpec()` and `migrate()` treat "written at the current
 * version" as done — so a fix that is not accompanied by a bump reaches
 * un-migrated rules only and leaves the migrated ones on the old, wrong
 * spec for good.
 *
 *   2  reads Workiz's `{any: [...]}` condition groups (25 rules kept their
 *      three sources in one, and a rule read without its group fires for
 *      every source).
 */
export const TRANSLATOR_VERSION = 2;

export interface TranslationResult {
  spec?: AutomationSpec;
  runnable: boolean;
  notRunnableReason?: string;
  notes: string[];
}

// --- Workiz vocabulary ------------------------------------------------------

/** Workiz job status (as written in a rule) → BitCRM super-status. */
const SUPER_STATUS: Readonly<Record<string, string>> = {
  submitted: 'submitted',
  'in progress': 'in_progress',
  done: 'done',
  pending: 'pending',
  'done pending approval': 'done_pending_approval',
  canceled: 'canceled',
  cancelled: 'canceled',
};

/** Facts that describe the export, not the rule. Dropped, with a note. */
const PLUMBING = new Set(['account_id', 'doctype', 'created_timestamp', 'is_deleted', 'finalized']);

/** Call facts BitCRM does not record; they only ever exclude edge cases. */
const CALL_PLUMBING = new Set(['blocked', 'rejected']);

/** Facts with no BitCRM equivalent — a rule that narrows on one cannot run. */
const UNSUPPORTED_FACTS: Readonly<Record<string, string>> = {
  job_amount_due: 'the job balance is not a condition BitCRM models',
  job_total_price: 'the job total is not a condition BitCRM models',
  is_paid_in_full: 'payment completion is not a condition BitCRM models',
  is_sent: 'document "sent" state is not a condition BitCRM models',
  sent: 'document "sent" state is not a condition BitCRM models',
  invoice_id: 'invoices are not an automation entity in BitCRM',
  schedule_type: 'the Workiz schedule type has no BitCRM field',
  converted_to_job: 'BitCRM has no separate lead entity to convert',
  client_plan_is_canceled: 'service plans are not in BitCRM',
  service_plan_id: 'service plans are not in BitCRM',
  flow_id: 'a call-flow filter is not a condition the rule engine offers yet',
  uid_answered: 'the answering agent is not published on call.completed yet',
};

/** Workiz entities with no BitCRM automation entity. */
const UNSUPPORTED_ENTITIES: Readonly<Record<string, string>> = {
  invoice: 'Workiz invoice rules have no BitCRM equivalent (invoices are not an automation entity)',
  estimate: 'Workiz estimate rules have no BitCRM equivalent',
  lead: 'BitCRM has no separate lead entity (owner decision 2026-09-16: every lead is a job)',
  visit: 'Workiz service-plan visits are not in BitCRM',
};

interface WorkizCondition {
  fact?: string;
  entity?: string;
  operator?: string;
  value?: unknown;
  friendly_strings?: { fact?: string; value?: string };
  mainConditionId?: boolean;
  /** An OR group: Workiz nests one inside `conditions.all` instead of a fact. */
  any?: WorkizCondition[];
}

interface WorkizTimeInterval {
  value?: number | string;
  operator?: string | null;
  time_field?: string | null;
  time_unit?: string | null;
}

interface WorkizEvent {
  type?: string;
  notify_medium?: string;
  receiverType?: string;
  roleId?: string | null;
  users_to?: string[];
  message_template?: string;
  message_subject_template?: string;
  time_interval?: WorkizTimeInterval;
  working_hours?: { dnd?: boolean; from?: string; to?: string };
  webhook_url?: string;
}

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const asString = (value: unknown): string => (value === undefined || value === null ? '' : String(value)).trim();
const asList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v) => v !== null && v !== undefined).map((v) => asString(v)) : [asString(value)];

const MINUTES_PER_UNIT: Readonly<Record<string, number>> = { minutes: 1, hours: 60, days: 1440, weeks: 10080 };

// --- the translation --------------------------------------------------------

export function translateWorkizRule(rule: AutomationRule): TranslationResult {
  const notes: string[] = [];
  const entities = (rule.entities ?? []).map((e) => asString(e));
  const blockedEntity = entities.find((e) => UNSUPPORTED_ENTITIES[e]);
  if (blockedEntity) return { runnable: false, notRunnableReason: UNSUPPORTED_ENTITIES[blockedEntity], notes };

  const all = asArray<WorkizCondition>((rule.conditions as { all?: unknown } | undefined)?.all);
  const events = asArray<WorkizEvent>(rule.events);
  const isCall = entities.includes('incoming_call');

  const read = isCall ? readCallConditions(all, notes) : readJobConditions(all, notes);
  if ('reason' in read) return { runnable: false, notRunnableReason: read.reason, notes };

  const timing = readTiming(events, notes);
  const trigger = buildTrigger(read, timing, isCall, notes);
  const { actions, blocked } = readActions(events, notes);

  const spec: AutomationSpec = {
    version: 1,
    trigger,
    conditions: read.conditions,
    actions,
    ...(timing.timing ? { timing: timing.timing } : {}),
  };

  if (!actions.length) {
    return { spec, runnable: false, notRunnableReason: blocked ?? 'the rule does nothing the engine can do', notes };
  }
  if (!hasExecutableAction(actions)) {
    return { spec, runnable: false, notRunnableReason: NOTHING_EXECUTABLE_REASON, notes };
  }
  return { spec, runnable: true, notes };
}

// --- conditions -------------------------------------------------------------

interface ReadConditions {
  conditions: AutomationConditionNode[];
  /** The condition that names the trigger, when the rule has one. */
  statusTo?: { values: string[]; labels: string[] };
  subStatusTo?: { values: string[]; labels: string[] };
  createdOnly?: boolean;
  hasTag?: boolean;
  callOutcome?: 'missed' | 'answered' | 'voicemail';
  callDirection?: 'inbound' | 'outbound';
}

function readJobConditions(all: WorkizCondition[], notes: string[]): ReadConditions | { reason: string } {
  const out: ReadConditions = { conditions: [] };
  const dropped: string[] = [];

  for (const c of all) {
    if (Array.isArray(c.any)) {
      const group = readGroup(c.any);
      if ('reason' in group) return group;
      out.conditions.push(group.node);
      continue;
    }
    const fact = asString(c.fact);
    if (!fact) continue;
    if (PLUMBING.has(fact)) {
      dropped.push(fact);
      continue;
    }
    const unsupported = UNSUPPORTED_FACTS[fact];
    if (unsupported) return { reason: `condition "${c.friendly_strings?.fact ?? fact}": ${unsupported}` };

    switch (fact) {
      case 'is_lead': {
        if (asString(c.value) === '1') {
          return { reason: 'a leads-only rule; BitCRM has no separate lead entity' };
        }
        out.conditions.push({ field: 'isLead', op: 'eq', values: ['false'], labels: ['a job'] });
        break;
      }
      case 'status': {
        const values = asList(c.value)
          .map((v) => SUPER_STATUS[v.toLowerCase()])
          .filter(Boolean);
        if (!values.length) {
          dropped.push(`${fact}=${asList(c.value).join('/')}`);
          break;
        }
        const friendly = asString(c.friendly_strings?.value).toLowerCase();
        const negated = c.operator === 'notEqual' || c.operator === 'notIn';
        // "is created" is Workiz's way of saying "any open status": it is
        // the creation trigger *and* the exclusion it was written with
        // (`status notIn [Done, Canceled]`). Keeping only the trigger would
        // text a job created straight into Done, which Workiz never did.
        if (friendly === 'is created') {
          out.createdOnly = true;
          if (negated) out.conditions.push({ field: 'status', op: 'not_in', values, labels: asList(c.value) });
          else out.conditions.push({ field: 'status', op: 'in', values, labels: asList(c.value) });
          break;
        }
        if (negated) {
          out.conditions.push({ field: 'status', op: 'not_in', values, labels: asList(c.value) });
          break;
        }
        out.statusTo = { values, labels: asList(c.value) };
        out.conditions.push({ field: 'status', op: 'in', values, labels: asList(c.value) });
        break;
      }
      case 'sub_status_id': {
        const ids = asList(c.value).filter(Boolean);
        if (!ids.length) break;
        const values = ids.map((id) => bitcrmId('substatus', id));
        const labels = [asString(c.friendly_strings?.value) || `sub-status ${ids.join('/')}`];
        if (c.operator === 'notEqual' || c.operator === 'notIn') {
          out.conditions.push({ field: 'subStatus', op: 'not_in', values, labels });
          break;
        }
        out.subStatusTo = { values, labels };
        out.conditions.push({ field: 'subStatus', op: 'in', values, labels });
        break;
      }
      case 'tags': {
        const ids = asList(c.value).filter(Boolean);
        if (!ids.length) break;
        out.hasTag = true;
        out.conditions.push({
          field: 'tag',
          op: c.operator === 'notIn' || c.operator === 'notEqual' ? 'not_in' : 'in',
          values: ids.map((id) => bitcrmId('tag', id)),
          labels: [asString(c.friendly_strings?.value) || `tag ${ids.join('/')}`],
        });
        break;
      }
      case 'adgroup_id':
        out.conditions.push(catalogCondition('source', 'adgroup', c));
        break;
      case 'job_type':
        out.conditions.push(catalogCondition('jobType', 'jobtype', c));
        break;
      case 'metro_id':
        out.conditions.push(catalogCondition('serviceArea', 'metro', c));
        break;
      case 'tech_names':
        out.conditions.push({
          field: 'hasTechs',
          op: c.operator === 'notEqual' && asString(c.value) === '' ? 'exists' : 'not_exists',
        });
        break;
      default:
        dropped.push(fact);
    }
  }

  if (dropped.length) notes.push(`Conditions not carried over (account plumbing): ${[...new Set(dropped)].join(', ')}.`);
  return out;
}

function readCallConditions(all: WorkizCondition[], notes: string[]): ReadConditions | { reason: string } {
  const out: ReadConditions = { conditions: [] };
  const dropped: string[] = [];

  for (const c of all) {
    if (Array.isArray(c.any)) {
      // No exported phone rule has one; if one appears it narrows the rule,
      // and a narrowing this cannot read must stop the rule, not vanish.
      return { reason: 'an "any of" condition group on a phone rule, which BitCRM cannot narrow a call on yet' };
    }
    const fact = asString(c.fact);
    if (!fact) continue;
    if (PLUMBING.has(fact) || CALL_PLUMBING.has(fact)) {
      dropped.push(fact);
      continue;
    }
    const unsupported = UNSUPPORTED_FACTS[fact];
    if (unsupported) return { reason: `condition "${c.friendly_strings?.fact ?? fact}": ${unsupported}` };

    switch (fact) {
      case 'dial_call_status': {
        const values = asList(c.value).map((v) => v.toLowerCase());
        out.callOutcome = values.includes('completed') ? 'answered' : 'missed';
        break;
      }
      case 'call_status':
        out.callOutcome = asString(c.value).toLowerCase() === 'completed' ? 'answered' : 'missed';
        break;
      case 'voicemail':
      case 'voicemail_business_logic':
        if (asString(c.value) === '1') out.callOutcome = 'voicemail';
        else dropped.push(`${fact}=0`);
        break;
      case 'direction':
      case 'direction_business_logic': {
        const direction = asString(c.value).toLowerCase();
        if (direction === 'inbound' || direction === 'outbound') out.callDirection = direction;
        break;
      }
      case 'is_lead':
        break;
      default:
        dropped.push(fact);
    }
  }

  if (dropped.length) notes.push(`Call conditions not carried over: ${[...new Set(dropped)].join(', ')}.`);
  return out;
}

/**
 * Facts an alternative inside a group may be — the three catalog
 * narrowings, which is every fact the 79 imported group conditions use.
 * An alternative is only ever a narrowing, never the trigger, so the facts
 * that name one (`status`, `sub_status_id`) are deliberately absent, and so
 * is anything else: a group this cannot read stops its rule rather than
 * being quietly made smaller.
 */
const GROUP_LEAF_FIELDS: Readonly<Record<string, 'adgroup' | 'jobtype' | 'metro'>> = {
  adgroup_id: 'adgroup',
  job_type: 'jobtype',
  metro_id: 'metro',
};

const GROUP_LEAF_CONDITION_FIELD: Readonly<Record<'adgroup' | 'jobtype' | 'metro', AutomationCondition['field']>> = {
  adgroup: 'source',
  jobtype: 'jobType',
  metro: 'serviceArea',
};

/**
 * A Workiz `{any: [...]}` group — "the source is GMB **or** Yelp **or**
 * Facebook". All 79 of these in the export are `adgroup_id equal`, so when
 * every alternative is the same field asking for equality the group
 * collapses into one `in` condition with several values: simpler, and
 * exactly what Workiz meant.
 *
 * A group with an alternative this cannot read is never dropped — dropping
 * it is what made 25 rules fire for every source instead of three. It makes
 * the whole rule not runnable, with the fact named, exactly as an
 * untranslatable flat condition does.
 */
function readGroup(leaves: WorkizCondition[]): { node: AutomationConditionNode } | { reason: string } {
  const conditions: AutomationCondition[] = [];
  for (const leaf of leaves) {
    const fact = asString(leaf.fact);
    const namespace = GROUP_LEAF_FIELDS[fact];
    if (!namespace) {
      const named = asString(leaf.friendly_strings?.fact) || fact || 'an unnamed fact';
      return { reason: `an "any of" condition group on "${named}", which BitCRM cannot narrow on` };
    }
    const condition = catalogCondition(GROUP_LEAF_CONDITION_FIELD[namespace], namespace, leaf);
    // An alternative with nothing to compare against narrows nothing, and the
    // evaluator reads that as holding — which makes the whole group hold and
    // the rule fire for every source. Stopping the rule is the same answer an
    // unreadable alternative gets, and for the same reason.
    if (!condition.values?.length) {
      return { reason: `an "any of" condition group with an empty "${fact}" alternative` };
    }
    conditions.push(condition);
  }
  if (!conditions.length) return { reason: 'an empty "any of" condition group, which would hold for nothing' };
  if (conditions.length === 1) return { node: conditions[0] };

  const [first] = conditions;
  if (conditions.every((c) => c.field === first.field && c.op === 'in')) {
    return {
      node: {
        field: first.field,
        op: 'in',
        values: conditions.flatMap((c) => c.values ?? []),
        // One label per value, whatever each alternative carried, so the
        // sentence can name every source rather than only the first.
        labels: conditions.flatMap((c) => (c.values ?? []).map((v, i) => c.labels?.[i] ?? c.labels?.[0] ?? v)),
      },
    };
  }
  return { node: { any: conditions } };
}

function catalogCondition(
  field: AutomationCondition['field'],
  namespace: 'adgroup' | 'jobtype' | 'metro',
  c: WorkizCondition,
): AutomationCondition {
  const ids = asList(c.value).filter(Boolean);
  return {
    field,
    op: c.operator === 'notEqual' || c.operator === 'notIn' ? 'not_in' : 'in',
    values: ids.map((id) => bitcrmId(namespace, id)),
    labels: [asString(c.friendly_strings?.value) || ids.join('/')],
  };
}

// --- timing -----------------------------------------------------------------

interface ReadTiming {
  timing?: AutomationSpec['timing'];
  /** Set when the delay counts from the job's own date — a relative reminder, not a delay. */
  relative?: { anchor: 'scheduledStart'; offsetMinutes: number };
}

function readTiming(events: WorkizEvent[], notes: string[]): ReadTiming {
  const first = events.find((e) => e.time_interval || e.working_hours);
  if (!first) return {};

  const out: ReadTiming = {};
  const timing: NonNullable<AutomationSpec['timing']> = {};

  const interval = first.time_interval ?? {};
  const amount = Number(interval.value ?? 0);
  const unit = MINUTES_PER_UNIT[asString(interval.time_unit) || 'minutes'] ?? 1;
  const minutes = Number.isFinite(amount) ? Math.abs(amount) * unit : 0;
  const field = asString(interval.time_field);

  if (minutes > 0 || field === 'job_date_utc') {
    if (field === 'job_date_utc') {
      out.relative = { anchor: 'scheduledStart', offsetMinutes: interval.operator === 'ahead' ? -minutes : minutes };
    } else if (interval.operator === 'ahead') {
      notes.push(
        `Workiz sent this ${minutes} minutes before "${field || 'the trigger'}", which is not a moment the engine can wait for; it now sends immediately.`,
      );
    } else {
      timing.delayMinutes = minutes;
    }
  }

  const hours = first.working_hours;
  if (hours?.dnd && hours.from && hours.to) {
    timing.workingHours = { from: hours.from, to: hours.to };
    timing.quietHours = 'hold';
  } else if (hours && hours.dnd === false) {
    // Workiz's "do not disturb" switch was off: the rule sent at any hour.
    timing.quietHours = 'ignore';
    notes.push('Workiz sent this rule at any hour (DND off), so it ignores the workspace quiet hours.');
  }

  if (Object.keys(timing).length) out.timing = timing;

  const intervals = new Set(
    events
      .filter((e) => e.time_interval)
      .map((e) => `${e.time_interval?.value}#${e.time_interval?.operator}#${e.time_interval?.time_field}`),
  );
  if (intervals.size > 1) notes.push('The rule had different delays per message; the first one applies to all of them.');
  return out;
}

// --- trigger ----------------------------------------------------------------

function buildTrigger(read: ReadConditions, timing: ReadTiming, isCall: boolean, notes: string[]): AutomationTrigger {
  if (timing.relative) {
    return { kind: 'schedule.relative', anchor: timing.relative.anchor, offsetMinutes: timing.relative.offsetMinutes };
  }
  if (isCall) {
    return {
      kind: 'call.completed',
      callOutcome: read.callOutcome ?? 'any',
      ...(read.callDirection ? { callDirection: read.callDirection } : {}),
    };
  }
  // A tag can be added minutes after the status is reached, and Workiz fires
  // the first time the whole combination holds — that is `deal.updated`,
  // which keys on the state rather than on the edit.
  if (read.hasTag) {
    notes.push('The rule watches a job tag, so it fires the first time the job matches, not only on a status change.');
    return { kind: 'deal.updated' };
  }
  if (read.subStatusTo) return { kind: 'deal.status_changed', toSubStatus: read.subStatusTo.values };
  if (read.statusTo) return { kind: 'deal.status_changed', to: read.statusTo.values };
  if (read.createdOnly) return { kind: 'deal.created' };
  return { kind: 'deal.updated' };
}

// --- actions ----------------------------------------------------------------

function readActions(events: WorkizEvent[], notes: string[]): { actions: AutomationAction[]; blocked?: string } {
  const actions: AutomationAction[] = [];
  let blocked: string | undefined;
  const renamed = new Set<string>();
  const unknown = new Set<string>();

  for (const event of events) {
    const type = asString(event.type);
    if (type === 'notification') {
      const medium = asString(event.notify_medium).toLowerCase();
      const action: AutomationAction = {
        type: medium === 'email' ? 'send_email' : medium === 'inapp' ? 'send_in_app' : 'send_sms',
        ...recipientOf(event, notes),
      };
      const body = rewriteShortCodes(bodyOf(event.message_template, medium === 'email'));
      body.renamed.forEach((r) => renamed.add(r));
      body.unknown.forEach((u) => unknown.add(u));
      if (body.text.trim()) action.body = body.text;
      const subject = rewriteShortCodes(event.message_subject_template);
      if (subject.text.trim() && medium === 'email') action.subject = subject.text.trim();
      actions.push(action);
      continue;
    }
    if (type === 'webhookPost') {
      const url = asString(event.webhook_url);
      if (!url) {
        blocked ??= 'the webhook has no URL';
        continue;
      }
      actions.push({ type: 'webhook', url, method: 'POST' });
      notes.push("The webhook's Workiz auth key was not carried over — add it to the action's headers if the endpoint needs one.");
      continue;
    }
    if (type === 'createEntity') {
      blocked ??= 'the rule creates a Workiz entity, which the engine cannot do';
      continue;
    }
    if (type) blocked ??= `unknown Workiz action "${type}"`;
  }

  if (renamed.size) notes.push(`Short codes renamed to their BitCRM spelling: ${[...renamed].join(', ')}.`);
  if (unknown.size) notes.push(`Short codes with no BitCRM value (they render empty): ${[...unknown].join(', ')}.`);
  return { actions, blocked };
}

function recipientOf(event: WorkizEvent, notes: string[]): Partial<AutomationAction> {
  switch (asString(event.receiverType)) {
    case 'client':
      return { to: 'client' };
    case 'tech':
      return { to: 'assigned_techs' };
    case 'users': {
      const ids = (event.users_to ?? []).map((id) => bitcrmId('user', asString(id)));
      if (!ids.length) notes.push('A message was addressed to named users, but the rule listed none.');
      return { to: 'users', userIds: ids };
    }
    case 'role': {
      const roleId = asString(event.roleId);
      return roleId ? { to: 'role', roleIds: [bitcrmId('role', roleId)] } : { to: 'dispatcher' };
    }
    default:
      return { to: 'client' };
  }
}

/** The stored body is HTML; an SMS keeps the text, an email keeps the markup. */
function bodyOf(template: string | undefined, isEmail: boolean): string {
  const body = template ?? '';
  if (isEmail || !looksLikeHtml(body)) return body;
  return htmlToText(body);
}
