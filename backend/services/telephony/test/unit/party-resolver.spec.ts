import {
  partyStorage,
  resolveParties,
  resolveParty,
  storedParties,
  type PartyLookups,
} from '../../src/calls/party-resolver';
import { type CallRecord } from '../../src/calls/calls.repository';

/**
 * The single place that decides who was on a call. It used to be duplicated
 * between the API enricher and the web client, which could disagree about the
 * same record; these cases pin the precedence down.
 */
const base: CallRecord = {
  callSid: 'CA1',
  startedAt: '2026-08-05T10:00:00.000Z',
  updatedAt: '2026-08-05T10:00:00.000Z',
};

const noLookups: PartyLookups = { users: {}, personals: {}, contacts: {} };

const lookups = (over: Partial<PartyLookups> = {}): PartyLookups => ({
  ...noLookups,
  ...over,
});

describe('resolveParty', () => {
  describe('softphone participants', () => {
    it('puts the dialler on `from` for an outbound call', () => {
      const call: CallRecord = {
        ...base,
        direction: 'outbound',
        from: '+12624061115',
        to: '+380958601427',
        participants: [{ userId: 'u1', role: 'caller', at: '' }],
      };
      const users = { u1: { name: 'Nazarii', roleId: 'role-dispatcher' } };

      expect(resolveParty(call, 'from', lookups({ users }))).toEqual({
        kind: 'user',
        id: 'u1',
        name: 'Nazarii',
        roleId: 'role-dispatcher',
      });
      // Nobody claims the far side.
      expect(resolveParty(call, 'to', lookups({ users }))).toBeUndefined();
    });

    it('puts the answerer on `to` for an inbound call', () => {
      const call: CallRecord = {
        ...base,
        direction: 'inbound',
        from: '+380958601427',
        to: '+12624061115',
        participants: [{ userId: 'u2', role: 'answered', at: '' }],
      };
      const users = { u2: { name: 'Tamir' } };

      expect(resolveParty(call, 'to', lookups({ users }))?.id).toBe('u2');
      expect(resolveParty(call, 'from', lookups({ users }))).toBeUndefined();
    });

    it('resolves both sides of an internal call', () => {
      const call: CallRecord = {
        ...base,
        direction: 'outbound',
        from: '+12624061115',
        to: '+12624061116',
        participants: [
          { userId: 'u1', role: 'caller', at: '' },
          { userId: 'u2', role: 'answered', at: '' },
        ],
      };
      const users = { u1: { name: 'Nazarii' }, u2: { name: 'Tamir' } };

      const parties = resolveParties(call, lookups({ users }));
      expect(parties.from?.name).toBe('Nazarii');
      expect(parties.to?.name).toBe('Tamir');
    });

    it('falls back to the stored agent when nobody picked up', () => {
      const call: CallRecord = {
        ...base,
        direction: 'inbound',
        to: '+12624061115',
        agentId: 'u3',
      };
      const users = { u3: { name: 'Nazarii', roleId: 'role-admin' } };

      expect(resolveParty(call, 'to', lookups({ users }))).toMatchObject({
        id: 'u3',
        name: 'Nazarii',
        roleId: 'role-admin',
      });
    });

    it('renders an unresolvable user id rather than nothing', () => {
      const call: CallRecord = {
        ...base,
        direction: 'inbound',
        to: '+12624061115',
        agentId: 'd47814b8-e051-706e',
      };
      expect(resolveParty(call, 'to', noLookups)?.name).toBe('d47814b8…');
    });
  });

  describe('precedence', () => {
    const call: CallRecord = {
      ...base,
      direction: 'outbound',
      from: '+12624061115',
      to: '+15412830739',
    };

    it('prefers a teammate on their own phone over a CRM record', () => {
      const party = resolveParty(
        call,
        'to',
        lookups({
          personals: {
            '+15412830739': { id: 'u9', name: 'Tamir Levi', roleId: 'role-tech' },
          },
          contacts: {
            '+15412830739': { kind: 'contact', id: 'c1', name: 'Jane Roe' },
          },
        }),
      );

      // Ours beats theirs — a number on a teammate's profile is that teammate.
      expect(party).toMatchObject({ kind: 'user', id: 'u9', personal: true });
    });

    it('prefers the softphone participant over a personal-number match', () => {
      const answered: CallRecord = {
        ...base,
        direction: 'inbound',
        from: '+380958601427',
        to: '+12624061115',
        participants: [{ userId: 'u2', role: 'answered', at: '' }],
      };

      const party = resolveParty(
        answered,
        'to',
        lookups({
          users: { u2: { name: 'Tamir' } },
          personals: {
            '+12624061115': { id: 'u9', name: 'Somebody Else' },
          },
        }),
      );

      // They answered at their desk — not a call to their mobile.
      expect(party).toMatchObject({ id: 'u2' });
      expect(party?.personal).toBeUndefined();
    });

    it('falls through to a contact, then a company', () => {
      expect(
        resolveParty(
          call,
          'to',
          lookups({
            contacts: {
              '+15412830739': { kind: 'contact', id: 'c1', name: 'Jane Roe' },
            },
          }),
        ),
      ).toEqual({ kind: 'contact', id: 'c1', name: 'Jane Roe' });

      expect(
        resolveParty(
          call,
          'to',
          lookups({
            contacts: {
              '+15412830739': { kind: 'company', id: 'co1', name: 'Acme Locks' },
            },
          }),
        ),
      ).toEqual({ kind: 'company', id: 'co1', name: 'Acme Locks' });
    });

    it('resolves nobody for a number we have never seen', () => {
      expect(resolveParty(call, 'to', noLookups)).toBeUndefined();
    });
  });
});

describe('storedParties', () => {
  it('reads a frozen association back, without names', () => {
    const call: CallRecord = {
      ...base,
      fromPartyKind: 'user',
      fromPartyId: 'u1',
      toPartyKind: 'contact',
      toPartyId: 'c1',
    };

    // Names are deliberately absent — they're resolved fresh on every read so
    // a rename shows through on old calls.
    expect(storedParties(call)).toEqual({
      from: { kind: 'user', id: 'u1' },
      to: { kind: 'contact', id: 'c1' },
    });
  });

  it('keeps the personal marker', () => {
    expect(
      storedParties({
        ...base,
        toPartyKind: 'user',
        toPartyId: 'u9',
        toPartyPersonal: true,
      }).to,
    ).toEqual({ kind: 'user', id: 'u9', personal: true });
  });

  it('is empty for a record that was never frozen', () => {
    expect(storedParties(base)).toEqual({ from: undefined, to: undefined });
  });
});

describe('partyStorage', () => {
  it('keeps identity and drops the name', () => {
    expect(
      partyStorage({ kind: 'contact', id: 'c1', name: 'Jane Roe' }),
    ).toEqual({ kind: 'contact', id: 'c1' });
  });

  it('carries the personal marker, which display depends on', () => {
    expect(
      partyStorage({ kind: 'user', id: 'u9', name: 'Tamir', personal: true }),
    ).toEqual({ kind: 'user', id: 'u9', personal: true });
  });

  it('stores nothing for an unresolved side', () => {
    expect(partyStorage(undefined)).toBeUndefined();
  });
});
