import { type ConversationSendOptions, type ResolvedPermissions } from '@bitcrm/types';
import { SendService } from '../../../src/outbound/send.service';
import { type SendMessageDto } from '../../../src/outbound/dto/send-message.dto';
import { createMockConversation, T1 } from '../mocks';

/**
 * A client record can carry one of the workspace's own Twilio numbers (a
 * Workiz import, a test client, a call between two of our lines). Texting it
 * makes Twilio pick that same number as the sender and refuse with 21266
 * ("'To' and 'From' cannot be the same"). The send path never texts one of
 * our numbers: it skips them when choosing the recipient and refuses one
 * picked explicitly.
 */

const CM = '6f1f4d7e-0f5c-4b8e-9a6d-2c3b4a5d6e7f';
const OWN = '+14098777774';
const P2 = '+12034567865';
const P3 = '+12037479616';
const user = { id: 'u1', cognitoSub: 's', email: 'u1@x.co', roleId: 'r1', department: 'ops' };

function perms(): ResolvedPermissions {
  return {
    roleId: 'r1',
    roleName: 'Dispatcher',
    isSystemRole: false,
    permissions: {
      messages: { view: true, send: true, manage: true },
      team_chat: { view: true, send: true, manage_groups: false },
      contacts: { view: true, view_numbers: true },
    } as never,
    dataScope: { messages: 'all', team_chat: 'all' } as never,
    dealStageTransitions: [],
    hasOverrides: false,
  };
}

function makeService(opts: { phones: string[]; owned?: string[]; contactPhones?: string[] }) {
  const conversation = createMockConversation({ addresses: { phones: opts.phones, emails: [] } });
  const conversations = {
    get: jest.fn(async () => conversation),
    getByParty: jest.fn(async () => null),
    getByAddress: jest.fn(async () => null),
    findOrCreate: jest.fn(async (input: { conversation: unknown }) => ({ conversation: input.conversation, created: true })),
    update: jest.fn(async (c: object, patch: object) => ({ ...c, ...patch, updatedAt: T1 })),
    putReadMarker: jest.fn(async () => undefined),
  };
  const messages = {
    appendOutbound: jest.fn(async (input: { conversation: unknown }) => ({ duplicate: false, conversation: input.conversation })),
  };
  const optOuts = { isOptedOut: jest.fn(async () => false) };
  const sender = { resolve: jest.fn(async () => ({ source: 'pool' })) };
  const queue = { enqueue: jest.fn(async () => 'queued') };
  const deals = { find: jest.fn(async () => null) };
  const crm = {
    getContact: jest.fn(async () => ({ id: 'ct1', phones: opts.contactPhones ?? opts.phones, emails: [] })),
    findByPhone: jest.fn(async () => null),
  };
  const events = { conversationUpdated: jest.fn(async () => undefined) };
  const numbers = { ownedSet: jest.fn(async () => new Set(opts.owned ?? [OWN])) };
  const service = new SendService(
    conversations as any, messages as any, optOuts as any, sender as any, queue as any, deals as any, crm as any, events as any,
    undefined, undefined, undefined, undefined, undefined, numbers as any,
  );
  return { service, conversations, messages, sender, queue, numbers };
}

const dto = (overrides: Partial<SendMessageDto> = {}): SendMessageDto => ({ clientMessageId: CM, channel: 'sms', body: 'Hi', ...overrides });

describe('SendService — never texts one of our own numbers', () => {
  it('skips an owned number at the head of the list and texts the next phone (the 21266 case)', async () => {
    const { service, sender } = makeService({ phones: [OWN, P2, P3] });
    const m = await service.sendToConversation('c1', dto(), { user, perms: perms() });

    expect(m.to).toBe(P2);
    expect(sender.resolve).toHaveBeenCalledWith(expect.objectContaining({ to: P2 }));
  });

  it('400s with a clear message when the agent picks an owned number as To', async () => {
    const { service, messages } = makeService({ phones: [OWN, P2] });
    const err = await service.sendToConversation('c1', dto({ toAddress: OWN }), { user, perms: perms() }).catch((e) => e);

    expect(err.getStatus()).toBe(400);
    expect(err.message).toMatch(/one of the company's own numbers/);
    expect(messages.appendOutbound).not.toHaveBeenCalled();
  });

  it("400s when every number on the client is ours", async () => {
    const { service, messages } = makeService({ phones: [OWN] });
    const err = await service.sendToConversation('c1', dto(), { user, perms: perms() }).catch((e) => e);

    expect(err.getStatus()).toBe(400);
    expect(err.message).toBe("This client's only number is one of the company's own numbers");
    expect(messages.appendOutbound).not.toHaveBeenCalled();
  });

  it('a texting a bare owned number (POST /messages { phone }) is refused too', async () => {
    const { service } = makeService({ phones: [OWN] });
    const err = await service.sendToParty({ ...dto(), phone: OWN } as never, { user, perms: perms() }).catch((e) => e);
    expect(err.getStatus()).toBe(400);
  });

  it('automation sends follow the same rule', async () => {
    const ok = makeService({ phones: [OWN, P2] });
    const conversation = createMockConversation({ addresses: { phones: [OWN, P2], emails: [] } });
    const sent = await ok.service.sendSystem({
      conversation,
      body: 'On my way',
      origin: 'automation',
      clientMessageId: CM,
      actorId: 'system:automations',
    } as never);
    expect(sent.message.to).toBe(P2);

    const onlyOwn = makeService({ phones: [OWN] });
    const err = await onlyOwn.service
      .sendSystem({
        conversation: createMockConversation({ addresses: { phones: [OWN], emails: [] } }),
        body: 'On my way',
        origin: 'automation',
        clientMessageId: CM,
        actorId: 'system:automations',
      } as never)
      .catch((e) => e);
    expect(err.getStatus()).toBe(400);
  });

  it('with telephony unreachable (empty owned set) the first phone is used as before', async () => {
    const { service } = makeService({ phones: [OWN, P2], owned: [] });
    const m = await service.sendToConversation('c1', dto(), { user, perms: perms() });
    expect(m.to).toBe(OWN);
  });

  describe('send-options (what the composer shows as the recipient)', () => {
    const sms = (o: ConversationSendOptions) => o.channels.find((c) => c.channel === 'sms')!;

    it('shows the first phone that is not ours', async () => {
      const { service } = makeService({ phones: [OWN, P2] });
      expect(sms(await service.sendOptions('c1', { user, perms: perms() }))).toMatchObject({ available: true, to: P2 });
    });

    it('closes the channel with only_own_number when every phone is ours', async () => {
      const { service } = makeService({ phones: [OWN] });
      expect(sms(await service.sendOptions('c1', { user, perms: perms() }))).toEqual({
        channel: 'sms',
        available: false,
        reason: 'only_own_number',
      });
    });
  });

  it("a client's new thread does not copy our own numbers from CRM", async () => {
    const { service, conversations } = makeService({ phones: [], contactPhones: [OWN, P2] });
    const { conversation } = await service.conversationForContact('ct1');

    expect(conversation.addresses.phones).toEqual([P2]);
    expect(conversations.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ addresses: [{ address: P2, source: 'crm' }] }),
    );
  });
});
