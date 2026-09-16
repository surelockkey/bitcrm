import { type Conversation } from '@bitcrm/types';
import { EmailThreadResolver } from '../../../src/email/inbound/email-thread.resolver';
import { createMockConversation, T1 } from '../mocks';

const ID = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';
const SENDER = 'jane@example.com';
const AT = '2026-09-15T10:05:00.000Z';
const CFG = { fromAddress: 'office@example.com', replyDomain: 'reply.example.com' };

function make(f: {
  byId?: Record<string, Conversation | null>;
  pointer?: { conversationId: string; partyKind: string; partyId?: string } | null;
  psid?: { conversationId: string; messageSk: string } | null;
  directory?: unknown;
  findOrCreate?: { conversation: Conversation; created: boolean };
} = {}) {
  const conversations = {
    get: jest.fn(async (id: string) => f.byId?.[id] ?? null),
    getByAddress: jest.fn(async () => f.pointer ?? null),
    findOrCreate: jest.fn(async (args: { conversation: Conversation }) => f.findOrCreate ?? { conversation: args.conversation, created: true }),
    putAddressPointer: jest.fn(async () => undefined),
    update: jest.fn(async (current: Conversation, patch: Record<string, unknown>) => ({
      ...current,
      ...Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? undefined])),
      updatedAt: AT,
    })),
  };
  const messages = { getProviderSidPointer: jest.fn(async () => f.psid ?? null) };
  const directory = { lookupContact: jest.fn(async () => f.directory ?? null) };
  const resolver = new EmailThreadResolver(conversations as any, messages as any, directory as any, CFG);
  return { resolver, conversations, messages, directory };
}

const input = (over: Partial<Parameters<EmailThreadResolver['resolve']>[0]> = {}) => ({
  sender: SENDER,
  recipients: ['office@example.com'],
  ...over,
});

describe('EmailThreadResolver.resolve', () => {
  it('1. a reply token in the recipients names the conversation; the sender is adopted onto it', async () => {
    const conv = createMockConversation({ id: ID, addresses: { phones: ['+14045551234'], emails: [] } });
    const { resolver, conversations, directory } = make({ byId: { [ID]: conv } });
    const res = await resolver.resolve(input({ recipients: [`c-${ID}@reply.example.com`] }), AT);

    expect(res.route).toBe('token');
    expect(res.created).toBe(false);
    expect(res.party).toEqual({ kind: 'contact', id: 'ct1' });
    expect(res.conversation.addresses.emails).toEqual([SENDER]);
    expect(conversations.putAddressPointer).toHaveBeenCalledWith({ address: SENDER, conversationId: ID, partyKind: 'contact', partyId: 'ct1', source: 'crm', updatedAt: AT });
    expect(conversations.update).toHaveBeenCalledWith(conv, { addresses: { phones: ['+14045551234'], emails: [SENDER] } }, { at: AT });
    expect(conversations.getByAddress).not.toHaveBeenCalled();
    expect(directory.lookupContact).not.toHaveBeenCalled();
  });

  it('a token for a missing conversation falls through to the next rules', async () => {
    const { resolver, conversations } = make();
    const res = await resolver.resolve(input({ recipients: [`c-${ID}@reply.example.com`] }), AT);
    expect(res.route).toBe('unknown');
    expect(conversations.get).toHaveBeenCalledWith(ID);
  });

  it('2. In-Reply-To naming a Message-ID SES stamped routes through PSID#', async () => {
    const conv = createMockConversation({ id: 'c2', addresses: { phones: [], emails: [SENDER] } });
    const { resolver, conversations, messages } = make({ byId: { c2: conv }, psid: { conversationId: 'c2', messageSk: `MSG#${T1}#m1` } });
    const res = await resolver.resolve(input({ inReplyTo: '<0100019-abc@email.amazonses.com>', references: ['<x@gmail.com>'] }), AT);
    expect(res.route).toBe('reply');
    expect(messages.getProviderSidPointer).toHaveBeenCalledWith('0100019-abc');
    // already on the conversation: pointer refreshed, no address update
    expect(conversations.putAddressPointer).toHaveBeenCalledTimes(1);
    expect(conversations.update).not.toHaveBeenCalled();
  });

  it('ignores Message-IDs that are not ours and PSIDs that point nowhere', async () => {
    const { resolver, messages } = make({ psid: null });
    const res = await resolver.resolve(input({ inReplyTo: '<abc@mail.gmail.com>', references: ['<0100019-gone@email.amazonses.com>'] }), AT);
    expect(res.route).toBe('unknown');
    expect(messages.getProviderSidPointer).toHaveBeenCalledTimes(1);
  });

  it('3. ADDR# routes without asking the CRM and without a pointer write', async () => {
    const conv = createMockConversation({ id: 'c3' });
    const { resolver, conversations, directory } = make({ byId: { c3: conv }, pointer: { conversationId: 'c3', partyKind: 'contact', partyId: 'ct1' } });
    const res = await resolver.resolve(input(), AT);
    expect(res).toEqual({ conversation: conv, created: false, route: 'address', party: { kind: 'contact', id: 'ct1' } });
    expect(conversations.putAddressPointer).not.toHaveBeenCalled();
    expect(directory.lookupContact).not.toHaveBeenCalled();
  });

  it('4. a CRM hit opens the party conversation keyed CONVOF#contact#<id> with the email routed', async () => {
    const { resolver, conversations } = make({ directory: { kind: 'contact', id: 'ct9', name: 'Jane Doe' } });
    const res = await resolver.resolve(input(), AT);
    expect(res.route).toBe('directory');
    expect(res.created).toBe(true);
    expect(res.party).toEqual({ kind: 'contact', id: 'ct9', name: 'Jane Doe' });
    const args = conversations.findOrCreate.mock.calls[0][0] as any;
    expect(args.pointer).toEqual({ kind: 'contact', id: 'ct9' });
    expect(args.addresses).toEqual([{ address: SENDER, source: 'crm' }]);
    expect(args.conversation).toMatchObject({ kind: 'client', partyKind: 'contact', partyId: 'ct9', addresses: { phones: [], emails: [SENDER] }, state: 'open', unread: false, createdAt: AT });
  });

  it('a CRM hit whose party already has a conversation (from SMS) adopts the email onto it', async () => {
    const existing = createMockConversation({ id: 'c-sms', addresses: { phones: ['+14045551234'], emails: [] } });
    const { resolver, conversations } = make({ directory: { kind: 'contact', id: 'ct1' }, findOrCreate: { conversation: existing, created: false } });
    const res = await resolver.resolve(input(), AT);
    expect(res.route).toBe('directory');
    expect(res.created).toBe(false);
    expect(res.conversation.addresses.emails).toEqual([SENDER]);
    expect(conversations.putAddressPointer).toHaveBeenCalledWith(expect.objectContaining({ address: SENDER, conversationId: 'c-sms', source: 'crm' }));
  });

  it('5. nobody knows the address: an unknown conversation keyed CONVOF#address#<email>', async () => {
    const { resolver, conversations } = make();
    const res = await resolver.resolve(input(), AT);
    expect(res.route).toBe('unknown');
    expect(res.created).toBe(true);
    const args = conversations.findOrCreate.mock.calls[0][0] as any;
    expect(args.pointer).toEqual({ kind: 'address', id: SENDER });
    expect(args.addresses).toBeUndefined();
    expect(args.conversation).toMatchObject({ kind: 'unknown', partyKind: 'none', addresses: { phones: [], emails: [SENDER] } });
    expect(args.conversation.needsResolution).toBeUndefined();
  });

  it('a CRM that cannot be asked yields unknown with needsResolution, kept honest on an existing thread', async () => {
    const fresh = make({ directory: 'unreachable' });
    await fresh.resolver.resolve(input(), AT);
    expect((fresh.conversations.findOrCreate.mock.calls[0][0] as any).conversation.needsResolution).toBe(true);

    const stale = createMockConversation({ id: 'cu', kind: 'unknown', partyKind: 'none', partyId: undefined, needsResolution: true, addresses: { phones: [], emails: [SENDER] } });
    const healed = make({ findOrCreate: { conversation: stale, created: false } });
    const res = await healed.resolver.resolve(input(), AT);
    expect(healed.conversations.update).toHaveBeenCalledWith(stale, { needsResolution: null }, { at: AT });
    expect(res.conversation.needsResolution).toBeUndefined();
  });

  it('a dangling ADDR# (conversation gone) re-resolves', async () => {
    const { resolver, directory } = make({ pointer: { conversationId: 'c-gone', partyKind: 'none' }, directory: { kind: 'company', id: 'co1' } });
    const res = await resolver.resolve(input(), AT);
    expect(res.route).toBe('directory');
    expect(directory.lookupContact).toHaveBeenCalledWith(SENDER);
  });
});
