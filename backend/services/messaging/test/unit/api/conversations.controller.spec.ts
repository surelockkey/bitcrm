import { ConversationsController } from '../../../src/api/conversations/conversations.controller';
import { ConversationsService } from '../../../src/api/conversations/conversations.service';
import { CountersService } from '../../../src/api/counters/counters.service';
import { createMockConversation } from '../mocks';
import { ADMIN, adminPerms } from './api-mocks';

/** The controller is thin: validate → delegate → wrap. These lock the envelope. */
function make() {
  const conversations = {
    list: jest.fn().mockResolvedValue({ items: [createMockConversation()], nextCursor: 'N1' }),
    get: jest.fn().mockResolvedValue({ ...createMockConversation(), readMarker: undefined }),
    getByParty: jest.fn().mockResolvedValue(createMockConversation()),
    getByAddress: jest.fn().mockResolvedValue(createMockConversation()),
    getByJob: jest.fn().mockResolvedValue(createMockConversation()),
    textLookup: jest.fn().mockResolvedValue({ conversation: null, optOut: null, canText: false }),
    getInternal: jest.fn().mockResolvedValue(createMockConversation()),
    listInternal: jest.fn().mockResolvedValue({ items: [createMockConversation()], nextCursor: 'NEXT' }),
  } as unknown as ConversationsService;
  const counters = {
    get: jest.fn().mockResolvedValue({ unreadConversations: 1, flaggedConversations: 0, unreadByKind: {} }),
  } as unknown as CountersService;
  return { controller: new ConversationsController(conversations, counters), conversations, counters };
}

describe('ConversationsController', () => {
  it('GET /conversations wraps the page in the envelope with pagination', async () => {
    const { controller, conversations } = make();
    const perms = adminPerms();
    const res = await controller.list({ view: 'unread', limit: 20, cursor: 'C' }, ADMIN, perms);
    expect(conversations.list).toHaveBeenCalledWith({ view: 'unread', limit: 20, cursor: 'C' }, ADMIN, perms);
    expect(res).toEqual({
      success: true,
      data: [expect.objectContaining({ id: 'c1' })],
      pagination: { nextCursor: 'N1', count: 1 },
    });
  });

  it('GET /conversations/counters', async () => {
    const { controller } = make();
    expect(await controller.getCounters(ADMIN, adminPerms())).toEqual({
      success: true,
      data: { unreadConversations: 1, flaggedConversations: 0, unreadByKind: {} },
    });
  });

  it('lookups delegate with the caller and wrap', async () => {
    const { controller, conversations } = make();
    const perms = adminPerms();
    expect((await controller.byParty('contact', 'ct1', ADMIN, perms)).success).toBe(true);
    expect(conversations.getByParty).toHaveBeenCalledWith('contact', 'ct1', ADMIN, perms);

    expect((await controller.byAddress({ address: '+14045551234' }, ADMIN, perms)).data).toMatchObject({ id: 'c1' });
    expect(conversations.getByAddress).toHaveBeenCalledWith('+14045551234', ADMIN, perms);

    expect((await controller.byJob('d1', ADMIN, perms)).data).toMatchObject({ id: 'c1' });
    expect(conversations.getByJob).toHaveBeenCalledWith('d1', ADMIN, perms);

    const lookup = await controller.textLookup({ partyKind: 'contact', partyId: 'ct1' }, ADMIN, perms);
    expect(lookup).toEqual({ success: true, data: { conversation: null, optOut: null, canText: false } });

    expect((await controller.get('c1', ADMIN, perms)).data).toMatchObject({ id: 'c1' });
    expect(conversations.get).toHaveBeenCalledWith('c1', ADMIN, perms);
  });

  it('GET /conversations/internal/:id returns the raw conversation', async () => {
    const { controller, conversations } = make();
    expect((await controller.getInternal('c1')).data).toMatchObject({ id: 'c1' });
    expect(conversations.getInternal).toHaveBeenCalledWith('c1');
  });

  it('GET /conversations/internal/all answers the backfill shape { data: { items, nextCursor } }', async () => {
    const { controller, conversations } = make();
    const res = await controller.listInternal({ limit: 200, cursor: 'C1' });
    expect(conversations.listInternal).toHaveBeenCalledWith({ limit: 200, cursor: 'C1' });
    expect(res).toEqual({
      success: true,
      data: { items: [expect.objectContaining({ id: 'c1', addresses: { phones: ['+14045551234'], emails: [] } })], nextCursor: 'NEXT' },
    });
  });
});
