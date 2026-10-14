import { LIVE_STATUSES, type CallRecord } from './calls.repository';
import { partyNamesText } from './call-search';
import {
  partyStorage,
  resolveParties,
  storedParties,
  type CallPartyRef,
  type EnrichedCall,
  type PartyLookups,
  type ResolvedParties,
} from './party-resolver';
import { type ContactLookupService, type CallContact } from '../common/contact-lookup.service';
import { type UserPhoneLookupService, type CallUserPhone } from '../common/user-phone-lookup.service';
import { type UserNamesService, type UserSummary } from '../common/user-names.service';

/** The parties worth freezing onto a record (ids only — names stay dynamic). */
export type FrozenParties = {
  from?: { kind: string; id: string; personal?: boolean };
  to?: { kind: string; id: string; personal?: boolean };
};

/** One call, named — plus what the write path may persist about it. */
export interface NamedCall {
  call: EnrichedCall;
  /**
   * A finished call with no frozen association, resolved from its numbers:
   * what `setParties` should freeze. Absent for a live call, a call already
   * frozen, or one nobody could be matched to.
   */
  freeze?: FrozenParties;
  /**
   * Both sides' folded names — what the Search box matches — when the call
   * has ended and every side that exists got a name (a lookup blip must not
   * erase names). Compare with the record's `partyNames` before writing.
   */
  searchText?: string;
}

/**
 * Never in a response: the Search box's folded names, and the job total the
 * reports read (money, behind `financials.view` — the list is `calls.view`).
 */
export function withoutStoredExtras(call: CallRecord): CallRecord {
  if (call.partyNames === undefined && call.dealTotal === undefined && call.dealTotalAt === undefined) {
    return call;
  }
  const { partyNames: _n, dealTotal: _t, dealTotalAt: _a, ...rest } = call;
  return rest;
}

/**
 * Names both sides of calls. Three lookups, all batched across the records and
 * all best-effort — a party we can't name renders as a bare number:
 *
 * - system users on the call as softphone participants (agent + participants)
 * - system users reached on their **personal** number, matched by endpoint
 * - everyone else, matched against CRM contacts
 *
 * A number that belongs to one of our people is deliberately resolved as that
 * person, not as a client, even if a contact record also carries it.
 *
 * Pure with respect to storage: it NEVER writes. What a finished call should
 * have frozen / stamped comes back beside the named call, and only the write
 * path (CallFinalizer) acts on it — a read of the log never writes.
 */
export class CallNamer {
  constructor(
    private readonly userNames?: Pick<UserNamesService, 'resolve'>,
    private readonly contacts?: Pick<ContactLookupService, 'resolve' | 'resolveRefs'>,
    private readonly userPhones?: Pick<UserPhoneLookupService, 'resolve'>,
  ) {}

  async name(records: CallRecord[]): Promise<NamedCall[]> {
    const ids = records.flatMap((r) => [
      ...(r.agentId ? [r.agentId] : []),
      ...(r.participants?.map((p) => p.userId) ?? []),
    ]);
    const phones = records.flatMap((r) => [...(r.from ? [r.from] : []), ...(r.to ? [r.to] : [])]);
    if (ids.length === 0 && phones.length === 0) {
      return records.map((r) => ({ call: withoutStoredExtras(r) }));
    }

    const [users, contacts, personals] = await Promise.all([
      ids.length && this.userNames
        ? this.userNames.resolve(ids)
        : Promise.resolve<Record<string, UserSummary>>({}),
      phones.length && this.contacts
        ? this.contacts.resolve(phones)
        : Promise.resolve<Record<string, CallContact>>({}),
      phones.length && this.userPhones
        ? this.userPhones.resolve(phones)
        : Promise.resolve<Record<string, CallUserPhone>>({}),
    ]);

    const lookups: PartyLookups = { users, personals, contacts };

    // Frozen client associations carry only an id; fetch their current names
    // so a renamed client reads correctly on calls from years ago.
    const parties = records.map((r) => this.partiesFor(r, lookups));
    const refs = parties.flatMap(({ resolved }) =>
      [resolved.from, resolved.to].flatMap((party) =>
        party && party.kind !== 'user' && !party.name ? [{ kind: party.kind, id: party.id }] : [],
      ),
    );
    const refNames =
      refs.length && this.contacts?.resolveRefs
        ? await this.contacts.resolveRefs(refs as Array<{ kind: 'contact' | 'company'; id: string }>)
        : {};
    const withName = (party?: CallPartyRef) =>
      party && !party.name && party.kind !== 'user'
        ? { ...party, name: refNames[`${party.kind}:${party.id}`] }
        : party;

    return records.map((rec, i) => {
      const r = withoutStoredExtras(rec);
      const agent = r.agentId ? users[r.agentId] : undefined;
      const from = withName(parties[i].resolved.from);
      const to = withName(parties[i].resolved.to);

      const call: EnrichedCall = {
        ...r,
        ...(agent ? { agentName: agent.name, agentRoleId: agent.roleId } : {}),
        ...(from ? { fromParty: from } : {}),
        ...(to ? { toParty: to } : {}),
        ...(r.participants
          ? {
              participants: r.participants.map((p) => {
                const u = users[p.userId];
                return u ? { ...p, name: u.name, roleId: u.roleId } : p;
              }),
            }
          : {}),
      };
      const searchText = this.searchTextOf(rec, from, to, users);
      return {
        call,
        ...(parties[i].freeze ? { freeze: parties[i].freeze } : {}),
        ...(searchText !== undefined ? { searchText } : {}),
      };
    });
  }

  /**
   * The folded names for the Search box — only for a finished call, and only
   * from a whole answer: a side whose name did not resolve (user-service or
   * the CRM blinking) yields nothing, or a blip would erase names.
   */
  private searchTextOf(
    call: CallRecord,
    from: CallPartyRef | undefined,
    to: CallPartyRef | undefined,
    users: Record<string, UserSummary>,
  ): string | undefined {
    if (call.status && LIVE_STATUSES.includes(call.status)) return undefined;
    const named = (party?: CallPartyRef) =>
      !party ||
      (party.kind === 'user'
        ? !!users[party.id]?.name || (!!party.personal && !!party.name)
        : !!party.name);
    if (!named(from) || !named(to)) return undefined;
    return partyNamesText([from?.name, to?.name]);
  }

  /**
   * The parties for one record: the frozen association when there is one,
   * otherwise resolved from the numbers — and, once the call has ended, what
   * should be frozen.
   */
  private partiesFor(
    call: CallRecord,
    lookups: PartyLookups,
  ): { resolved: ResolvedParties; freeze?: FrozenParties } {
    const stored = storedParties(call);
    if (stored.from || stored.to) return { resolved: this.nameStored(stored, lookups) };

    const resolved = resolveParties(call, lookups);
    const live = !!call.status && LIVE_STATUSES.includes(call.status);
    if (!live && (resolved.from || resolved.to)) {
      return {
        resolved,
        freeze: { from: partyStorage(resolved.from), to: partyStorage(resolved.to) },
      };
    }
    return { resolved };
  }

  /** Put today's names on a frozen association. */
  private nameStored(stored: ResolvedParties, lookups: PartyLookups): ResolvedParties {
    const named = (party?: CallPartyRef): CallPartyRef | undefined => {
      if (!party || party.kind !== 'user') return party;
      const user = lookups.users[party.id];
      return user ? { ...party, name: user.name, roleId: user.roleId } : party;
    };
    return { from: named(stored.from), to: named(stored.to) };
  }
}
