import { PartyResolver } from '../../../src/inbound/party-resolver';
import { type PhoneDirectory } from '../../../src/inbound/phone-directory';
import { type ConversationsRepository } from '../../../src/conversations/conversations.repository';

const PHONE = '+14045551234';

function make(over: {
  pointer?: unknown;
  user?: unknown;
  contact?: unknown;
} = {}) {
  const conversations = {
    getByAddress: jest.fn().mockResolvedValue(over.pointer ?? null),
  };
  const directory = {
    lookupUser: jest.fn().mockResolvedValue(over.user ?? null),
    lookupContact: jest.fn().mockResolvedValue(over.contact ?? null),
  };
  return {
    resolver: new PartyResolver(
      conversations as unknown as ConversationsRepository,
      directory as unknown as PhoneDirectory,
    ),
    conversations,
    directory,
  };
}

describe('PartyResolver', () => {
  it('answers from ADDR# without asking any directory', async () => {
    const { resolver, directory } = make({
      pointer: { address: PHONE, conversationId: 'c1', partyKind: 'contact', partyId: 'ct1', source: 'crm', updatedAt: 'x' },
    });
    expect(await resolver.resolve(PHONE)).toEqual({
      party: { kind: 'contact', id: 'ct1' },
      conversationId: 'c1',
      degraded: false,
    });
    expect(directory.lookupUser).not.toHaveBeenCalled();
    expect(directory.lookupContact).not.toHaveBeenCalled();
  });

  it('an ADDR# row with no party (unknown conversation) still routes to its conversation', async () => {
    const { resolver } = make({
      pointer: { address: PHONE, conversationId: 'c9', partyKind: 'none', source: 'import', updatedAt: 'x' },
    });
    expect(await resolver.resolve(PHONE)).toEqual({ party: undefined, conversationId: 'c9', degraded: false });
  });

  it('prefers one of our own people over a CRM contact', async () => {
    const { resolver, directory } = make({
      user: { id: 'u1', name: 'Ann' },
      contact: { kind: 'contact', id: 'ct1' },
    });
    expect(await resolver.resolve(PHONE)).toEqual({ party: { kind: 'user', id: 'u1', name: 'Ann' }, degraded: false });
    expect(directory.lookupContact).not.toHaveBeenCalled();
  });

  it('falls through to the CRM contact or company', async () => {
    expect(await make({ contact: { kind: 'contact', id: 'ct1', name: 'Bob' } }).resolver.resolve(PHONE)).toEqual({
      party: { kind: 'contact', id: 'ct1', name: 'Bob' },
      degraded: false,
    });
    expect(await make({ contact: { kind: 'company', id: 'co1' } }).resolver.resolve(PHONE)).toEqual({
      party: { kind: 'company', id: 'co1', name: undefined },
      degraded: false,
    });
  });

  it('answers nobody when both directories miss', async () => {
    expect(await make().resolver.resolve(PHONE)).toEqual({ degraded: false });
  });

  it('flags a provisional answer when a directory was unreachable', async () => {
    expect(await make({ user: 'unreachable' }).resolver.resolve(PHONE)).toEqual({ degraded: true });
    expect(await make({ contact: 'unreachable' }).resolver.resolve(PHONE)).toEqual({ degraded: true });
    // user-service down but the CRM knows the number: a definite answer
    expect(await make({ user: 'unreachable', contact: { kind: 'contact', id: 'ct1' } }).resolver.resolve(PHONE)).toEqual({
      party: { kind: 'contact', id: 'ct1', name: undefined },
      degraded: false,
    });
  });

  it('lookup() skips the pointer', async () => {
    const { resolver, conversations } = make({ contact: { kind: 'contact', id: 'ct1' } });
    await resolver.lookup(PHONE);
    expect(conversations.getByAddress).not.toHaveBeenCalled();
  });
});
