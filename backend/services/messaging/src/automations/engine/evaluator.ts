import {
  isAutomationConditionGroup,
  type AutomationCondition,
  type AutomationConditionGroup,
  type AutomationConditionNode,
  type AutomationSpec,
  type AutomationTrigger,
  type AutomationTriggerKind,
} from '@bitcrm/types';
import { conditionFacts, type AutomationFacts } from './facts';
import { entityOf, occurrenceOf, type AutomationEvent } from './trigger-event';

/**
 * The pure half of the rule engine: does this event, against these facts,
 * fire this rule — and under what occurrence key. No I/O, no clock beyond
 * the `now` handed in, so the whole trigger × condition matrix is a table
 * test.
 *
 * Workiz semantics kept deliberately:
 *
 *   • "a job has a status of X" fires on a job **created** straight into X
 *     as well as on a move into it (`trigger.onCreate`, default true).
 *   • a rule whose conditions include a tag is stored as `deal.updated`:
 *     the tag is often added minutes after the status, and Workiz fires the
 *     first time the whole combination holds. The occurrence key is then
 *     the *state*, not the edit, so a dozen later edits fire nothing.
 *   • conditions are ANDed; `in` / `not_in` compare sets (a job carries
 *     many tags and many technicians). A `{any: [...]}` entry is Workiz's
 *     OR — one of its own holding is enough for that entry.
 */

export interface TriggerMiss {
  matched: false;
  reason: string;
}
export interface TriggerHit {
  matched: true;
}
export type TriggerResult = TriggerHit | TriggerMiss;

const miss = (reason: string): TriggerMiss => ({ matched: false, reason });
const HIT: TriggerHit = { matched: true };

const hasAny = (values: string[] | undefined, wanted: string[] | undefined): boolean =>
  !wanted?.length || (values ?? []).some((v) => wanted.includes(v));

/** Which event kinds a trigger accepts (a `deal.updated` rule listens to every job event). */
export const DEAL_EVENT_KINDS: readonly AutomationTriggerKind[] = [
  'deal.created',
  'deal.updated',
  'deal.status_changed',
  'deal.tech_assigned',
  'deal.scheduled_changed',
];

export function matchesTrigger(trigger: AutomationTrigger, event: AutomationEvent): TriggerResult {
  switch (trigger.kind) {
    case 'deal.created':
      return event.kind === 'deal.created' ? HIT : miss(`trigger deal.created does not take ${event.kind}`);

    case 'deal.status_changed': {
      const onCreate = trigger.onCreate !== false;
      const isCreate = event.kind === 'deal.created';
      if (event.kind !== 'deal.status_changed' && !(isCreate && onCreate)) {
        return miss(`trigger deal.status_changed does not take ${event.kind}`);
      }
      const s = event.status ?? {};
      if (!hasAny(s.to ? [s.to] : [], trigger.to)) return miss(`status ${s.to ?? '-'} is not one of the trigger's`);
      if (trigger.from?.length && !hasAny(s.from ? [s.from] : [], trigger.from)) {
        return miss(`previous status ${s.from ?? '-'} is not one of the trigger's`);
      }
      if (trigger.toSubStatus?.length && !hasAny(s.toSubStatusId ? [s.toSubStatusId] : [], trigger.toSubStatus)) {
        return miss('sub-status is not one of the trigger\'s');
      }
      return HIT;
    }

    case 'deal.tech_assigned':
      return event.kind === 'deal.tech_assigned' ? HIT : miss(`trigger deal.tech_assigned does not take ${event.kind}`);

    case 'deal.scheduled_changed':
      return event.kind === 'deal.scheduled_changed'
        ? HIT
        : miss(`trigger deal.scheduled_changed does not take ${event.kind}`);

    case 'deal.updated':
      return DEAL_EVENT_KINDS.includes(event.kind) ? HIT : miss(`trigger deal.updated does not take ${event.kind}`);

    case 'call.completed': {
      if (event.kind !== 'call.completed') return miss(`trigger call.completed does not take ${event.kind}`);
      const wanted = trigger.callOutcome ?? 'any';
      if (wanted !== 'any' && event.call?.outcome !== wanted) {
        return miss(`call outcome ${event.call?.outcome ?? '-'} is not ${wanted}`);
      }
      const direction = trigger.callDirection ?? 'any';
      if (direction !== 'any' && event.call?.direction !== direction) {
        return miss(`call direction ${event.call?.direction ?? '-'} is not ${direction}`);
      }
      return HIT;
    }

    case 'message.received': {
      if (event.kind !== 'message.received') return miss(`trigger message.received does not take ${event.kind}`);
      const channel = trigger.messageChannel ?? 'any';
      if (channel !== 'any' && event.message?.channel !== channel) {
        return miss(`message channel ${event.message?.channel ?? '-'} is not ${channel}`);
      }
      const party = trigger.messagePartyKind ?? 'any';
      if (party !== 'any' && event.message?.partyKind !== party) {
        return miss(`message party ${event.message?.partyKind ?? '-'} is not ${party}`);
      }
      return HIT;
    }

    case 'schedule.relative':
      return event.kind === 'schedule.relative' ? HIT : miss(`trigger schedule.relative does not take ${event.kind}`);

    default:
      return miss(`unknown trigger ${String((trigger as AutomationTrigger).kind)}`);
  }
}

/** One condition against the facts. An unknown fact never holds — nothing fires on a guess. */
export function matchesCondition(condition: AutomationCondition, facts: AutomationFacts): TriggerResult {
  const values = conditionFacts(condition.field, facts);
  const wanted = condition.values ?? [];
  const present = (values ?? []).filter((v) => v !== '' && v !== undefined);

  switch (condition.op) {
    case 'exists':
      return present.length ? HIT : miss(`${condition.field} is empty`);
    case 'not_exists':
      return present.length ? miss(`${condition.field} is set`) : HIT;
    case 'in':
    case 'eq': {
      if (values === undefined) return miss(`${condition.field} is unknown here`);
      const want = condition.op === 'eq' ? wanted.slice(0, 1) : wanted;
      if (!want.length) return HIT;
      return present.some((v) => want.includes(v)) ? HIT : miss(`${condition.field} is not ${want.join('/')}`);
    }
    case 'not_in':
    case 'ne': {
      if (values === undefined) return miss(`${condition.field} is unknown here`);
      const want = condition.op === 'ne' ? wanted.slice(0, 1) : wanted;
      if (!want.length) return HIT;
      return present.some((v) => want.includes(v)) ? miss(`${condition.field} is ${want.join('/')}`) : HIT;
    }
    default:
      return miss(`unknown operator ${String(condition.op)}`);
  }
}

/**
 * An OR group: one alternative holding is enough. An empty group holds for
 * nothing — it is not a rule that fires for everything, which is the whole
 * point of carrying groups at all.
 */
export function matchesConditionGroup(group: AutomationConditionGroup, facts: AutomationFacts): TriggerResult {
  const misses: string[] = [];
  for (const condition of group.any ?? []) {
    const result = matchesCondition(condition, facts);
    if (result.matched) return HIT;
    misses.push(result.reason);
  }
  return miss(misses.length ? `no alternative holds: ${misses.join('; ')}` : 'an empty condition group never holds');
}

/** The top level is AND; a `{any: [...]}` entry is OR inside it. */
export function matchesConditions(
  conditions: AutomationConditionNode[] | undefined,
  facts: AutomationFacts,
): TriggerResult {
  for (const node of conditions ?? []) {
    const result = isAutomationConditionGroup(node)
      ? matchesConditionGroup(node, facts)
      : matchesCondition(node, facts);
    if (!result.matched) return result;
  }
  return HIT;
}

export interface RuleFired {
  fired: true;
  /** `<ruleId>#<entity>#<occurrence>` — what the run log refuses twice. */
  idempotencyKey: string;
  occurrence: string;
  entity: string;
  /** When the actions should run: now, or `timing.delayMinutes` from now. */
  dueAt: string;
  delayed: boolean;
}
export interface RuleSkipped {
  fired: false;
  reason: string;
}
export type RuleDecision = RuleFired | RuleSkipped;

export const idempotencyKey = (ruleId: string, entity: string, occurrence: string): string =>
  `${ruleId}#${entity}#${occurrence}`;

/**
 * Trigger, then conditions, then the occurrence key and the due time.
 * Whether that key has been used before is the caller's question (the run
 * log answers it) — this stays pure.
 */
export function evaluateRule(
  rule: { id: string; spec?: AutomationSpec },
  event: AutomationEvent,
  facts: AutomationFacts,
  now: Date = new Date(),
): RuleDecision {
  const spec = rule.spec;
  if (!spec) return { fired: false, reason: 'rule has no spec' };
  if (!spec.actions?.length) return { fired: false, reason: 'rule has no actions' };

  // A timer fires the rule it was armed for, nothing else.
  if (event.kind === 'schedule.relative' && event.timer && event.timer.ruleId !== rule.id) {
    return { fired: false, reason: 'timer belongs to another rule' };
  }

  const trigger = matchesTrigger(spec.trigger, event);
  if (!trigger.matched) return { fired: false, reason: trigger.reason };

  const conditions = matchesConditions(spec.conditions ?? [], facts);
  if (!conditions.matched) return { fired: false, reason: conditions.reason };

  const occurrence = occurrenceOf(event, spec.conditions ?? [], facts, spec.trigger.kind);
  const entity = entityOf(event);
  const delayMinutes = spec.timing?.delayMinutes ?? 0;
  const dueAt = delayMinutes > 0 ? new Date(now.getTime() + delayMinutes * 60_000).toISOString() : now.toISOString();

  return {
    fired: true,
    occurrence,
    entity,
    idempotencyKey: idempotencyKey(rule.id, entity, occurrence),
    dueAt,
    delayed: delayMinutes > 0,
  };
}
