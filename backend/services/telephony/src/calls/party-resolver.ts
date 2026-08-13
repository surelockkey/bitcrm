import { type CallRecord } from './calls.repository';
import { type CallContact } from '../common/contact-lookup.service';
import { type CallUserPhone } from '../common/user-phone-lookup.service';
import { type UserSummary } from '../common/user-names.service';

/**
 * Who was on one side of a call, in the one shape everything downstream uses:
 * what gets frozen onto the record, what the API returns, what the UI renders.
 *
 * Before this existed the precedence lived in three places — the enricher, the
 * web `callParty`, and the softphone screen-pop — and they could disagree
 * about the same call.
 */
export interface CallPartyRef {
  kind: 'user' | 'contact' | 'company';
  id: string;
  /** Resolved at read time, so a rename shows through on old calls. */
  name?: string;
  /** Users only. */
  roleId?: string;
  /** A teammate reached on their own phone rather than their softphone. */
  personal?: boolean;
}

/** A call as the API returns it: the record plus who was on each side. */
export interface EnrichedCall extends CallRecord {
  fromParty?: CallPartyRef;
  toParty?: CallPartyRef;
}

export interface ResolvedParties {
  from?: CallPartyRef;
  to?: CallPartyRef;
}

/** Everything a resolution pass needs, all of it batched by the caller. */
export interface PartyLookups {
  /** System users by id — softphone participants and the stored agent. */
  users: Record<string, UserSummary>;
  /** Numbers belonging to one of our own people. */
  personals: Record<string, CallUserPhone>;
  /** Numbers belonging to a CRM contact or company. */
  contacts: Record<string, CallContact>;
}

const shortId = (id: string) => `${id.slice(0, 8)}…`;

/**
 * The precedence, in one place and in this order:
 *
 *  1. a softphone participant on that side — they were demonstrably on the
 *     call, which beats any inference from the number;
 *  2. one of our own people, matched by their personal number;
 *  3. a CRM contact, then a company main line.
 *
 * Outbound calls carry our caller on `from`, inbound ones our answerer on
 * `to`, and an internal call has one of ours on both sides.
 */
export function resolveParty(
  call: CallRecord,
  side: 'from' | 'to',
  lookups: PartyLookups,
): CallPartyRef | undefined {
  const number = side === 'from' ? call.from : call.to;
  const caller = call.participants?.find((p) => p.role === 'caller');
  const answered = call.participants?.find((p) => p.role === 'answered');

  const asUser = (userId: string, name?: string): CallPartyRef => {
    const resolved = lookups.users[userId];
    return {
      kind: 'user',
      id: userId,
      name: resolved?.name ?? name ?? shortId(userId),
      roleId: resolved?.roleId,
    };
  };

  // 1. On the call through the softphone.
  if (side === 'from') {
    if (call.direction !== 'inbound') {
      if (caller) return asUser(caller.userId, caller.name);
      if (call.agentId) return asUser(call.agentId, call.agentName);
    }
  } else if (call.direction === 'inbound') {
    if (answered) return asUser(answered.userId, answered.name);
    if (call.agentId) return asUser(call.agentId, call.agentName);
  } else if (answered && answered.userId !== caller?.userId) {
    // Outbound to one of our own numbers — the internal call's receiver.
    return asUser(answered.userId, answered.name);
  }

  if (!number) return undefined;

  // 2. Their own phone, dialled by us.
  const personal = lookups.personals[number];
  if (personal) {
    return {
      kind: 'user',
      id: personal.id,
      name: personal.name,
      roleId: personal.roleId,
      personal: true,
    };
  }

  // 3. Somebody in the CRM.
  const contact = lookups.contacts[number];
  if (contact) {
    return { kind: contact.kind, id: contact.id, name: contact.name };
  }
  return undefined;
}

/**
 * Who a bare number belongs to, with no call record in hand — what the
 * softphone needs when it rings. Same ordering as the tail of
 * {@link resolveParty}: one of our own first, then the CRM.
 */
export function identifyNumber(
  number: string,
  lookups: Pick<PartyLookups, 'personals' | 'contacts'>,
): CallPartyRef | undefined {
  const personal = lookups.personals[number];
  if (personal) {
    return {
      kind: 'user',
      id: personal.id,
      name: personal.name,
      roleId: personal.roleId,
      personal: true,
    };
  }
  const contact = lookups.contacts[number];
  return contact
    ? { kind: contact.kind, id: contact.id, name: contact.name }
    : undefined;
}

export function resolveParties(
  call: CallRecord,
  lookups: PartyLookups,
): ResolvedParties {
  return {
    from: resolveParty(call, 'from', lookups),
    to: resolveParty(call, 'to', lookups),
  };
}

/**
 * The association already frozen onto a record, if any. Names are deliberately
 * absent — they're resolved fresh on every read so a rename shows through on
 * calls that happened years ago.
 */
export function storedParties(call: CallRecord): ResolvedParties {
  const side = (
    kind?: 'user' | 'contact' | 'company',
    id?: string,
    personal?: boolean,
  ): CallPartyRef | undefined =>
    kind && id ? { kind, id, ...(personal ? { personal: true } : {}) } : undefined;

  return {
    from: side(call.fromPartyKind, call.fromPartyId, call.fromPartyPersonal),
    to: side(call.toPartyKind, call.toPartyId, call.toPartyPersonal),
  };
}

/** The subset that is worth freezing onto the record (names stay dynamic). */
export function partyStorage(
  party: CallPartyRef | undefined,
): { kind: string; id: string; personal?: boolean } | undefined {
  if (!party) return undefined;
  return {
    kind: party.kind,
    id: party.id,
    ...(party.personal ? { personal: true } : {}),
  };
}
