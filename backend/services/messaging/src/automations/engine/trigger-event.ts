import { createHash } from 'node:crypto';
import { type AutomationCondition, type AutomationTriggerKind } from '@bitcrm/types';
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
 * The state a `deal.updated` rule fired for: the values of the facts *this
 * rule* reads, hashed. Workiz's "when a job has a status of X [and tag Y]"
 * fires the first time the combination holds — the tag may be added minutes
 * after the status — so the occurrence is the state, not the edit.
 */
export function stateOccurrence(conditions: AutomationCondition[], facts: AutomationFacts): string {
  const d = facts.deal;
  const parts = [
    `status=${d?.superStatus ?? ''}`,
    `sub=${d?.subStatusId ?? ''}`,
    ...conditions.map((c) => `${c.field}=${(conditionFacts(c.field, facts) ?? []).slice().sort().join('|')}`),
  ];
  return `state:${sha1(parts.join(';'))}`;
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
  conditions: AutomationCondition[],
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
