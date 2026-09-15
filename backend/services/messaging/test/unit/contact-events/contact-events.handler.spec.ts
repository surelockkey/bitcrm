import { type Conversation, type ConversationAddressPointer, type ConversationPointer } from '@bitcrm/types';
import { CONTACT_EVENTS_ACTOR, ContactEventsHandler } from '../../../src/contact-events/contact-events.handler';
import {
  isContactMergedPayload,
  isContactUpdatedPayload,
} from '../../../src/contact-events/contact-events.payloads';
import { createMockConversation, T0 } from '../mocks';

const pointer = (id: string, conversationId: string): ConversationPointer => ({
  pointerKind: 'contact',
  pointerId: id,
  conversationId,
  createdAt: T0,
});

const addr = (address: string, conversationId: string, partyId: string | undefined, partyKind: ConversationAddressPointer['partyKind'] = 'contact'): ConversationAddressPointer => ({
  address,
  conversationId,
  partyKind,
  partyId,
  source: 'crm',
  updatedAt: T0,
});

function makeHandler(opts: {
  pointers?: Record<string, ConversationPointer | null>;
  conversations?: Record<string, Conversation | null>;
  addresses?: Record<string, ConversationAddressPointer | null>;
  contact?: { id: string; phones: string[]; emails: string[] } | null;
  claim?: boolean;
} = {}) {
  const conversations = {
    getPointer: jest.fn(async (_kind: string, id: string) => opts.pointers?.[id] ?? null),
    get: jest.fn(async (id: string) => opts.conversations?.[id] ?? null),
    getByParty: jest.fn(async (_kind: string, id: string) => {
      const p = opts.pointers?.[id];
      return p ? opts.conversations?.[p.conversationId] ?? null : null;
    }),
    getByAddress: jest.fn(async (address: string) => opts.addresses?.[address] ?? null),
    putAddressPointer: jest.fn(async () => undefined),
    removeAddressPointer: jest.fn(async () => undefined),
    update: jest.fn(async (current: Conversation, patch: Record<string, unknown>) => ({ ...current, ...patch })),
  };
  const pointers = {
    putPartyPointer: jest.fn(async () => opts.claim ?? true),
    removePartyPointer: jest.fn(async () => true),
  };
  const crm = { getContact: jest.fn(async () => opts.contact ?? null) };
  const handler = new ContactEventsHandler(conversations as any, pointers as any, crm as any);
  return { handler, conversations, pointers, crm };
}

describe('contact-events payload guards (EVENTS.md shapes)', () => {
  it('accepts what crm-service publishes and rejects anything else', () => {
    expect(isContactMergedPayload({ oldContactId: 'a', newContactId: 'b' })).toBe(true);
    expect(isContactMergedPayload({ oldContactId: 'a' })).toBe(false);
    expect(isContactMergedPayload(null)).toBe(false);
    expect(isContactUpdatedPayload({ contactId: 'a' })).toBe(true);
    expect(isContactUpdatedPayload({ contactId: '' })).toBe(false);
    expect(isContactUpdatedPayload('a')).toBe(false);
  });
});

describe('ContactEventsHandler.onContactMerged', () => {
  it('drops a malformed payload without touching the table', async () => {
    const { handler, conversations } = makeHandler();
    await handler.onContactMerged({ contactId: 'x' });
    expect(conversations.getPointer).not.toHaveBeenCalled();
  });

  it('is a no-op when the merged contact never had a thread (or was already re-pointed)', async () => {
    const { handler, conversations, pointers } = makeHandler();
    await handler.onContactMerged({ oldContactId: 'dup', newContactId: 'keep' });
    expect(conversations.getPointer).toHaveBeenCalledWith('contact', 'dup');
    expect(pointers.putPartyPointer).not.toHaveBeenCalled();
    expect(conversations.update).not.toHaveBeenCalled();
  });

  it('hands the duplicate thread to a survivor without one: CONVOF#, partyId and ADDR# rows follow', async () => {
    const dupConv = createMockConversation({ id: 'c-dup', partyId: 'dup', addresses: { phones: ['+14045551234'], emails: ['a@x.co'] } });
    const { handler, conversations, pointers } = makeHandler({
      pointers: { dup: pointer('dup', 'c-dup') },
      conversations: { 'c-dup': dupConv },
      addresses: { '+14045551234': addr('+14045551234', 'c-dup', 'dup'), 'a@x.co': addr('a@x.co', 'c-dup', 'dup') },
    });

    await handler.onContactMerged({ oldContactId: 'dup', newContactId: 'keep' });

    expect(pointers.putPartyPointer).toHaveBeenCalledWith('contact', 'keep', 'c-dup', T0);
    expect(conversations.putAddressPointer).toHaveBeenCalledTimes(2);
    expect(conversations.putAddressPointer).toHaveBeenCalledWith(
      expect.objectContaining({ address: '+14045551234', conversationId: 'c-dup', partyKind: 'contact', partyId: 'keep', source: 'crm' }),
    );
    expect(conversations.update).toHaveBeenCalledWith(dupConv, { partyKind: 'contact', partyId: 'keep' }, { actorId: CONTACT_EVENTS_ACTOR });
    expect(pointers.removePartyPointer).toHaveBeenCalledWith('contact', 'dup', 'c-dup');
  });

  it('is idempotent: a replay after a partial run rewrites nothing that is already right', async () => {
    const dupConv = createMockConversation({ id: 'c-dup', partyId: 'keep', addresses: { phones: ['+14045551234'], emails: [] } });
    const { handler, conversations, pointers } = makeHandler({
      // survivor pointer already points at the duplicate's thread, old key still there
      pointers: { dup: pointer('dup', 'c-dup'), keep: pointer('keep', 'c-dup') },
      conversations: { 'c-dup': dupConv },
      addresses: { '+14045551234': addr('+14045551234', 'c-dup', 'keep') },
    });

    await handler.onContactMerged({ oldContactId: 'dup', newContactId: 'keep' });

    expect(pointers.putPartyPointer).toHaveBeenCalledWith('contact', 'keep', 'c-dup', T0);
    expect(conversations.putAddressPointer).not.toHaveBeenCalled();
    expect(conversations.update).not.toHaveBeenCalled();
    expect(pointers.removePartyPointer).toHaveBeenCalledWith('contact', 'dup', 'c-dup');
  });

  it('when both contacts had a thread, the survivor absorbs the addresses and the duplicate thread is re-labelled and archived', async () => {
    const dupConv = createMockConversation({ id: 'c-dup', partyId: 'dup', addresses: { phones: ['+14045559999'], emails: [] } });
    const keepConv = createMockConversation({ id: 'c-keep', partyId: 'keep', addresses: { phones: ['+14045551234'], emails: ['k@x.co'] } });
    const { handler, conversations, pointers } = makeHandler({
      pointers: { dup: pointer('dup', 'c-dup'), keep: pointer('keep', 'c-keep') },
      conversations: { 'c-dup': dupConv, 'c-keep': keepConv },
      addresses: { '+14045559999': addr('+14045559999', 'c-dup', 'dup') },
    });

    await handler.onContactMerged({ oldContactId: 'dup', newContactId: 'keep' });

    expect(pointers.putPartyPointer).not.toHaveBeenCalled();
    expect(conversations.update).toHaveBeenNthCalledWith(
      1,
      keepConv,
      { addresses: { phones: ['+14045551234', '+14045559999'], emails: ['k@x.co'] } },
      { actorId: CONTACT_EVENTS_ACTOR },
    );
    expect(conversations.putAddressPointer).toHaveBeenCalledWith(
      expect.objectContaining({ address: '+14045559999', conversationId: 'c-keep', partyId: 'keep' }),
    );
    expect(conversations.update).toHaveBeenNthCalledWith(
      2,
      dupConv,
      { partyKind: 'contact', partyId: 'keep', state: 'archived' },
      { actorId: CONTACT_EVENTS_ACTOR },
    );
    expect(pointers.removePartyPointer).toHaveBeenCalledWith('contact', 'dup', 'c-dup');
  });

  it('leaves an ADDR# row alone when another thread owns it', async () => {
    const dupConv = createMockConversation({ id: 'c-dup', partyId: 'dup', addresses: { phones: ['+14045559999'], emails: [] } });
    const { handler, conversations } = makeHandler({
      pointers: { dup: pointer('dup', 'c-dup') },
      conversations: { 'c-dup': dupConv },
      addresses: { '+14045559999': addr('+14045559999', 'c-other', 'someone-else') },
    });
    await handler.onContactMerged({ oldContactId: 'dup', newContactId: 'keep' });
    expect(conversations.putAddressPointer).not.toHaveBeenCalled();
  });

  it('falls back to absorbing when the survivor pointer is claimed by a racing first message', async () => {
    const dupConv = createMockConversation({ id: 'c-dup', partyId: 'dup', addresses: { phones: ['+14045559999'], emails: [] } });
    const raced = createMockConversation({ id: 'c-raced', partyId: 'keep', addresses: { phones: [], emails: [] } });
    const { handler, conversations, pointers } = makeHandler({
      pointers: { dup: pointer('dup', 'c-dup') },
      conversations: { 'c-dup': dupConv, 'c-raced': raced },
      claim: false,
    });
    // getByParty answers the raced thread once the put has been refused
    conversations.getByParty.mockResolvedValueOnce(raced);

    await handler.onContactMerged({ oldContactId: 'dup', newContactId: 'keep' });

    expect(pointers.putPartyPointer).toHaveBeenCalled();
    expect(conversations.update).toHaveBeenCalledWith(raced, { addresses: { phones: ['+14045559999'], emails: [] } }, { actorId: CONTACT_EVENTS_ACTOR });
    expect(conversations.update).toHaveBeenCalledWith(dupConv, { partyKind: 'contact', partyId: 'keep', state: 'archived' }, { actorId: CONTACT_EVENTS_ACTOR });
  });

  it('drops a dangling CONVOF# key whose thread no longer exists', async () => {
    const { handler, pointers, conversations } = makeHandler({ pointers: { dup: pointer('dup', 'gone') } });
    await handler.onContactMerged({ oldContactId: 'dup', newContactId: 'keep' });
    expect(pointers.removePartyPointer).toHaveBeenCalledWith('contact', 'dup', 'gone');
    expect(pointers.putPartyPointer).not.toHaveBeenCalled();
    expect(conversations.update).not.toHaveBeenCalled();
  });
});

describe('ContactEventsHandler.onContactUpdated', () => {
  it('drops a malformed payload', async () => {
    const { handler, conversations } = makeHandler();
    await handler.onContactUpdated({ id: 'x' });
    expect(conversations.getByParty).not.toHaveBeenCalled();
  });

  it('does nothing for a contact without a thread', async () => {
    const { handler, crm } = makeHandler();
    await handler.onContactUpdated({ contactId: 'ct1' });
    expect(crm.getContact).not.toHaveBeenCalled();
  });

  it('leaves the addresses alone when CRM cannot be read', async () => {
    const conv = createMockConversation();
    const { handler, conversations } = makeHandler({ pointers: { ct1: pointer('ct1', 'c1') }, conversations: { c1: conv }, contact: null });
    await handler.onContactUpdated({ contactId: 'ct1' });
    expect(conversations.putAddressPointer).not.toHaveBeenCalled();
    expect(conversations.update).not.toHaveBeenCalled();
  });

  it('writes an ADDR# row for an added phone/email and drops the row of a removed one', async () => {
    const conv = createMockConversation({ addresses: { phones: ['+14045551234', '+14045550000'], emails: [] } });
    const { handler, conversations } = makeHandler({
      pointers: { ct1: pointer('ct1', 'c1') },
      conversations: { c1: conv },
      contact: { id: 'ct1', phones: ['(404) 555-1234', '+14045559999'], emails: ['New@X.co'] },
      addresses: { '+14045550000': addr('+14045550000', 'c1', 'ct1') },
    });

    await handler.onContactUpdated({ contactId: 'ct1' });

    expect(conversations.putAddressPointer).toHaveBeenCalledTimes(2);
    expect(conversations.putAddressPointer).toHaveBeenCalledWith(
      expect.objectContaining({ address: '+14045559999', conversationId: 'c1', partyKind: 'contact', partyId: 'ct1', source: 'crm' }),
    );
    expect(conversations.putAddressPointer).toHaveBeenCalledWith(expect.objectContaining({ address: 'new@x.co', conversationId: 'c1' }));
    expect(conversations.removeAddressPointer).toHaveBeenCalledTimes(1);
    expect(conversations.removeAddressPointer).toHaveBeenCalledWith('+14045550000');
    expect(conversations.update).toHaveBeenCalledWith(
      conv,
      { addresses: { phones: ['+14045551234', '+14045559999'], emails: ['new@x.co'] } },
      { actorId: CONTACT_EVENTS_ACTOR },
    );
  });

  it('does not delete an ADDR# row that already points at another thread', async () => {
    const conv = createMockConversation({ addresses: { phones: ['+14045551234', '+14045550000'], emails: [] } });
    const { handler, conversations } = makeHandler({
      pointers: { ct1: pointer('ct1', 'c1') },
      conversations: { c1: conv },
      contact: { id: 'ct1', phones: ['+14045551234'], emails: [] },
      addresses: { '+14045550000': addr('+14045550000', 'c-other', 'ct2') },
    });
    await handler.onContactUpdated({ contactId: 'ct1' });
    expect(conversations.removeAddressPointer).not.toHaveBeenCalled();
    expect(conversations.update).toHaveBeenCalledWith(conv, { addresses: { phones: ['+14045551234'], emails: [] } }, { actorId: CONTACT_EVENTS_ACTOR });
  });

  it('re-points a number an unknown thread was holding once CRM says the contact owns it', async () => {
    const conv = createMockConversation({ addresses: { phones: ['+14045551234'], emails: [] } });
    const { handler, conversations } = makeHandler({
      pointers: { ct1: pointer('ct1', 'c1') },
      conversations: { c1: conv },
      contact: { id: 'ct1', phones: ['+14045551234', '+14045559999'], emails: [] },
      addresses: { '+14045559999': addr('+14045559999', 'c-unknown', undefined, 'none') },
    });
    await handler.onContactUpdated({ contactId: 'ct1' });
    expect(conversations.putAddressPointer).toHaveBeenCalledWith(expect.objectContaining({ address: '+14045559999', conversationId: 'c1', partyId: 'ct1' }));
  });

  it('is a no-op when CRM and the thread already agree (replay-safe)', async () => {
    const conv = createMockConversation({ addresses: { phones: ['+14045551234'], emails: ['a@x.co'] } });
    const { handler, conversations } = makeHandler({
      pointers: { ct1: pointer('ct1', 'c1') },
      conversations: { c1: conv },
      contact: { id: 'ct1', phones: ['+14045551234'], emails: ['a@x.co'] },
    });
    await handler.onContactUpdated({ contactId: 'ct1' });
    expect(conversations.putAddressPointer).not.toHaveBeenCalled();
    expect(conversations.removeAddressPointer).not.toHaveBeenCalled();
    expect(conversations.update).not.toHaveBeenCalled();
  });
});
