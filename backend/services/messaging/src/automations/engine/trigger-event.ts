import { createHash } from 'node:crypto';
import {
  isAutomationConditionGroup,
  type AutomationCondition,
  type AutomationConditionNode,
  type AutomationTriggerKind,
} from '@bitcrm/types';
import { conditionFacts, type AutomationFacts } from './facts';

/**
 * One thing that happened, normalized out of whatever carried it (an SNS
 * deal event, a call event, an inbound message, the scheduler's own timer).
 * The evaluator reads nothing else: `AutomationEvent` + `AutomationFacts`
 * are the whole input, which is what makes the rule matrix testable.
 */
export interface AutomationEvent {
  kind: AutomationTriggerKind;
  /** When it happened (ISO). Redeliveries carry the same value — occurrence keys may use it. */
  at: string;
  dealId?: string;
  /** `deal.status_changed` (and `deal.created`, which enters a status). */
  status?: {
    from?: string;
    to?: string;
    fromSubStatusId?: string | null;
    toSubStatusId?: string | null;
  };
  /** `deal.tech_assigned`. */
  techId?: string;
  /** `deal.scheduled_changed`. */
  schedule?: {
    fromDate?: string;
    fromTimeSlot?: string;
    toDate?: string;
    toTimeSlot?: string;
  };
  /** `call.completed`. */
  call?: { sid: string; outcome: 'missed' | 'answered' | 'voicemail'; direction?: 'inbound' | 'outbound' };
  /** `message.received`. */
  message?: { id: string; channel?: string; partyKind?: string };
  /** `schedule.relative` — the timer the scheduler armed, fired for exactly one rule. */
  timer?: { ruleId: string; anchorAt: string; offsetMinutes: number };
}

export const sha1 = (value: string): string => createHash('sha1').update(value).digest('hex');

/**
 * The values of one condition that actually make it hold — the matched
 * predicate, not the fact behind it.
 *
 * This is what keeps a `deal.updated` rule from re-sending. A job carries
 * many tags and many technicians; hashing all of them would make every
 * unrelated tag or roster edit a brand-new occurrence, and the rule would
 * text the same people again although it matches for exactly the same
 * reason as before. `in` / `eq` therefore contribute only the values the
 * condition asked for and found; `not_in` / `ne` / `exists` / `not_exists`
 * hold by absence or by "some value is there", which no particular value
 * distinguishes, so they contribute a constant.
 */
function matchedValues(condition: AutomationCondition, facts: AutomationFacts): string[] {
  if (condition.op !== 'in' && condition.op !== 'eq') return ['*'];
  const wanted = condition.op === 'eq' ? (condition.values ?? []).slice(0, 1) : (condition.values ?? []);
  if (!wanted.length) return ['*']; // an `in` with no values holds for anything
  return (conditionFacts(condition.field, facts) ?? []).filter((v) => wanted.includes(v)).slice().sort();
}

/**
 * The state a `deal.updated` rule fired for: the status the job is in plus
 * the predicates *this rule* matched on, hashed. Workiz's "when a job has a
 * status of X [and tag Y]" fires the first time the combination holds — the
 * tag may be added minutes after the status — so the occurrence is the
 * state, not the edit, and it changes only when the match itself changes.
 */
export function stateOccurrence(
  conditions: AutomationConditionNode[] | undefined,
  facts: AutomationFacts,
): string {
  const d = facts.deal;
  const parts = [
    `status=${d?.superStatus ?? ''}`,
    `sub=${d?.subStatusId ?? ''}`,
    ...(conditions ?? []).map((node) => nodeMatch(node, facts)),
  ];
  return `state:${sha1(parts.join(';'))}`;
}

/**
 * One entry's contribution to that hash. An OR group contributes every
 * alternative's, so a job that moves from one alternative to another (its
 * source retagged from Yelp to GMB) is a new state the rule may act on
 * again, while a change to a field the group never asked about is not.
 */
function nodeMatch(node: AutomationConditionNode, facts: AutomationFacts): string {
  if (!isAutomationConditionGroup(node)) return `${node.field}=${matchedValues(node, facts).join('|')}`;
  return `any(${(node.any ?? []).map((c) => `${c.field}=${matchedValues(c, facts).join('|')}`).join(',')})`;
}

/**
 * The stable identity of "this rule already handled this". Derived from the
 * event, never from the clock, so an SQS redelivery, a replayed queue or a
 * second consumer produces the same key:
 *
 *   deal.created            `created`
 *   deal.status_changed     `status:<from>><to>|<sub>@<statusChangedAt>`
 *   deal.tech_assigned      `tech:<techId>`
 *   deal.scheduled_changed  `sched:<newDate> <newSlot>`
 *   deal.updated            `state:<hash of the facts the rule reads>`
 *   call.completed          `call:<sid>`
 *   message.received        `msg:<messageId>`
 *   schedule.relative       `timer:<anchorAt><offset>`
 */
export function occurrenceOf(
  event: AutomationEvent,
  conditions: AutomationConditionNode[] | undefined,
  facts: AutomationFacts,
  triggerKind: AutomationTriggerKind,
): string {
  if (triggerKind === 'deal.updated') return stateOccurrence(conditions, facts);
  switch (event.kind) {
    case 'deal.created':
      return 'created';
    case 'deal.status_changed': {
      const s = event.status ?? {};
      const stamp = facts.deal?.statusChangedAt ?? event.at;
      return `status:${s.from ?? ''}>${s.to ?? ''}|${s.fromSubStatusId ?? ''}>${s.toSubStatusId ?? ''}@${stamp}`;
    }
    case 'deal.tech_assigned':
      return `tech:${event.techId ?? ''}`;
    case 'deal.scheduled_changed':
      return `sched:${event.schedule?.toDate ?? ''} ${event.schedule?.toTimeSlot ?? ''}`.trim();
    case 'call.completed':
      return `call:${event.call?.sid ?? ''}`;
    case 'message.received':
      return `msg:${event.message?.id ?? ''}`;
    case 'schedule.relative':
      return `timer:${event.timer?.anchorAt ?? ''}${event.timer?.offsetMinutes ?? 0}`;
    default:
      return `${event.kind}:${event.at}`;
  }
}

/** `deal:<id>` / `call:<sid>` / `message:<id>` — what the firing log files a run under. */
export function entityOf(event: AutomationEvent): string {
  if (event.call) return `call:${event.call.sid}`;
  if (event.message) return `message:${event.message.id}`;
  return `deal:${event.dealId ?? 'unknown'}`;
}
