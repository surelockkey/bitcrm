import { type AutomationConditionField } from '@bitcrm/types';

/**
 * What a rule is evaluated against — the job (and, for the phone and inbox
 * triggers, the call or the message) as it is *now*, flattened to the
 * fields `AutomationCondition.field` can name. Loaded by the caller
 * (`AutomationPeersClient.deal` + the event payload) and handed to the pure
 * evaluator, so every condition test is a synchronous array comparison and
 * the unit-test matrix needs no HTTP at all.
 */

/** The slice of a job every condition reads. */
export interface AutomationDealFacts {
  id: string;
  dealNumber?: string;
  contactId?: string;
  superStatus?: string;
  subStatusId?: string;
  tagIds?: string[];
  sourceId?: string;
  jobTypeId?: string;
  serviceAreaId?: string;
  assignedTechIds?: string[];
  assignedDispatcherId?: string;
  priority?: string;
  paymentStatus?: string;
  scheduledDate?: string;
  scheduledEndDate?: string;
  scheduledTimeSlot?: string;
  /** Re-stamped by deal-service on every real status move — the stable half of a status occurrence key. */
  statusChangedAt?: string;
  createdAt?: string;
}

/** The slice of a call the `call.completed` rules read. */
export interface AutomationCallFacts {
  callSid: string;
  direction?: 'inbound' | 'outbound';
  /** Twilio terminal status: `completed`, `no-answer`, `busy`, `failed`, `canceled`. */
  status?: string;
  /** `true` when the caller left a voicemail (telephony marks it on the record). */
  voicemail?: boolean;
  agentId?: string;
  from?: string;
  to?: string;
  contactId?: string;
}

/** The slice of an inbound message the `message.received` rules read. */
export interface AutomationMessageFacts {
  messageId: string;
  conversationId?: string;
  channel?: string;
  partyKind?: string;
  partyId?: string;
  dealId?: string;
  from?: string;
  to?: string;
}

export interface AutomationFacts {
  deal?: AutomationDealFacts;
  call?: AutomationCallFacts;
  message?: AutomationMessageFacts;
}

const list = (v: string | undefined | null): string[] | undefined =>
  v === undefined || v === null || v === '' ? undefined : [v];

/**
 * The values a condition field resolves to, or `undefined` when the fact is
 * not known at all (an unloaded job, a condition on a call in a job rule).
 * A multi-valued field (tags, the roster) answers with every value: `in`
 * holds when they intersect, `not_in` when they do not.
 */
export function conditionFacts(field: AutomationConditionField, facts: AutomationFacts): string[] | undefined {
  const d = facts.deal;
  switch (field) {
    case 'status':
      return list(d?.superStatus);
    case 'subStatus':
      return list(d?.subStatusId);
    case 'tag':
      return d?.tagIds ?? (d ? [] : undefined);
    case 'source':
      return list(d?.sourceId);
    case 'jobType':
      return list(d?.jobTypeId);
    case 'serviceArea':
      return list(d?.serviceAreaId);
    case 'isLead':
      // BitCRM has no separate lead entity (owner decision 2026-09-16): every
      // job is a job. The fact exists and is always `false` so an imported
      // `is_lead = 0` condition holds instead of blocking the rule.
      return d ? ['false'] : undefined;
    case 'hasTechs':
    case 'tech':
      return d?.assignedTechIds ?? (d ? [] : undefined);
    case 'dispatcher':
      return list(d?.assignedDispatcherId);
    case 'priority':
      return list(d?.priority);
    case 'paymentStatus':
      return list(d?.paymentStatus);
    case 'callDirection':
      return list(facts.call?.direction);
    case 'callStatus':
      return facts.call ? [facts.call.voicemail ? 'voicemail' : (facts.call.status ?? '')].filter(Boolean) : undefined;
    case 'callAgent':
      return list(facts.call?.agentId);
    case 'messageChannel':
      return list(facts.message?.channel);
    case 'messagePartyKind':
      return list(facts.message?.partyKind);
    default:
      return undefined;
  }
}
