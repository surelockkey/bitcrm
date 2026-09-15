import { TeamCountersService, isUnreadFor, unreadFromSk } from '../../../src/team/team-counters.service';
import { T0, T1, createMockConversation } from '../mocks';
import { mockConversationsRepo } from '../api/api-mocks';

const LAST = { lastMessageAt: T1, lastMessageId: 'm9', lastDirection: 'outbound' as const };
const MINE = createMockConversation({ id: 'c-me', kind: 'team', partyKind: 'user', partyId: 'tech-1', addresses: { phones: [], emails: [] }, ...LAST });
const GROUP = createMockConversation({ id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', memberIds: ['tech-1'], addresses: { phones: [], emails: [] }, ...LAST });
const marker = (over: Partial<{ lastReadAt: string; lastReadMessageSk: string }> = {}) => ({
  conversationId: 'x',
  userId: 'tech-1',
  lastReadAt: T0,
  ...over,
});

describe('isUnreadFor', () => {
  it('nothing on the thread → read; no marker → unread', () => {
    expect(isUnreadFor(createMockConversation({ kind: 'team', lastMessageAt: undefined }), 'tech-1', null)).toBe(false);
    expect(isUnreadFor(MINE, 'tech-1', null)).toBe(true);
  });

  it('the party’s own last message (inbound on their thread) is read for them, not for the office', () => {
    const fromTech = { ...MINE, lastDirection: 'inbound' as const };
    expect(isUnreadFor(fromTech, 'tech-1', null)).toBe(false);
    expect(isUnreadFor(fromTech, 'admin-1', null)).toBe(true);
  });

  it('a marker with a message key compares against the last message key', () => {
    expect(isUnreadFor(MINE, 'tech-1', marker({ lastReadMessageSk: `MSG#${T1}#m9` }))).toBe(false);
    expect(isUnreadFor(MINE, 'tech-1', marker({ lastReadMessageSk: `MSG#${T0}#m1` }))).toBe(true);
    expect(isUnreadFor({ ...MINE, lastMessageId: undefined }, 'tech-1', marker({ lastReadMessageSk: `MSG#${T1}#m9` }))).toBe(false);
  });

  it('a marker with only a time compares against lastMessageAt', () => {
    expect(isUnreadFor(MINE, 'tech-1', marker({ lastReadAt: T1 }))).toBe(false);
    expect(isUnreadFor(MINE, 'tech-1', marker({ lastReadAt: T0 }))).toBe(true);
  });

  it('a member who joined after the last message has nothing unread', () => {
    expect(isUnreadFor(GROUP, 'tech-1', null, '2026-09-16T00:00:00.000Z')).toBe(false);
    expect(isUnreadFor(GROUP, 'tech-1', null, T0)).toBe(true);
  });

  it('unreadFromSk picks the message key, else the time, else the join time', () => {
    expect(unreadFromSk(marker({ lastReadMessageSk: 'MSG#x' }))).toBe('MSG#x');
    expect(unreadFromSk(marker())).toBe(`MSG#${T0}`);
    expect(unreadFromSk(null, T1)).toBe(`MSG#${T1}`);
    expect(unreadFromSk(null)).toBeUndefined();
  });
});

function make() {
  const repo = mockConversationsRepo();
  const service = new TeamCountersService(repo as never);
  return { service, repo };
}

describe('TeamCountersService.conversationsOf', () => {
  it('collects the own thread and the open groups from MEMBEROF#, newest activity first, with membership rows', async () => {
    const { service, repo } = make();
    repo.listMemberOf.mockResolvedValue([
      { conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: T0 },
      { conversationId: 'g-archived', userId: 'tech-1', role: 'member', joinedAt: T0 },
    ]);
    repo.getByParty.mockResolvedValue({ ...MINE, lastMessageAt: T0 });
    repo.get.mockImplementation(async (id: string) =>
      id === 'g1' ? GROUP : id === 'g-archived' ? { ...GROUP, id, state: 'archived' } : null,
    );
    const { conversations, membership } = await service.conversationsOf('tech-1');
    expect(conversations.map((c) => c.id)).toEqual(['g1', 'c-me']);
    expect(membership.get('g1')?.joinedAt).toBe(T0);
    expect(repo.getByParty).toHaveBeenCalledWith('user', 'tech-1');
  });
});

describe('TeamCountersService.forUser', () => {
  it('counts unread threads per kind against the caller’s markers', async () => {
    const { service, repo } = make();
    repo.listMemberOf.mockResolvedValue([{ conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: T0 }]);
    repo.getByParty.mockResolvedValue(MINE);
    repo.get.mockResolvedValue(GROUP);
    repo.getReadMarker.mockImplementation(async (id: string) => (id === 'g1' ? marker({ lastReadMessageSk: `MSG#${T1}#m9` }) : null));
    expect(await service.forUser('tech-1')).toEqual({ unreadConversations: 1, unreadByKind: { team: 1 } });
  });

  it('is empty for someone with no threads', async () => {
    const { service } = make();
    expect(await service.forUser('nobody')).toEqual({ unreadConversations: 0, unreadByKind: {} });
  });
});

describe('TeamCountersService.readStateFor / decorate', () => {
  it('runs the count query only when the thread is unread, at least 1 when it is', async () => {
    const { service, repo } = make();
    repo.getReadMarker.mockResolvedValue(marker({ lastReadMessageSk: `MSG#${T0}#m1` }));
    repo.countMessagesAfter.mockResolvedValue(3);
    expect(await service.readStateFor(MINE, 'tech-1')).toEqual({
      viewerUnread: true,
      viewerUnreadCount: 3,
      readMarker: marker({ lastReadMessageSk: `MSG#${T0}#m1` }),
    });
    expect(repo.countMessagesAfter).toHaveBeenCalledWith('c-me', `MSG#${T0}#m1`, 99);

    repo.countMessagesAfter.mockResolvedValue(0);
    expect((await service.readStateFor(MINE, 'tech-1')).viewerUnreadCount).toBe(1);

    repo.countMessagesAfter.mockClear();
    repo.getReadMarker.mockResolvedValue(marker({ lastReadMessageSk: `MSG#${T1}#m9` }));
    expect(await service.readStateFor(MINE, 'tech-1')).toMatchObject({ viewerUnread: false, viewerUnreadCount: 0 });
    expect(repo.countMessagesAfter).not.toHaveBeenCalled();
  });

  it('decorate keeps the order and uses the join date for group members', async () => {
    const { service, repo } = make();
    repo.countMessagesAfter.mockResolvedValue(2);
    const membership = new Map([['g1', { conversationId: 'g1', userId: 'tech-1', role: 'member' as const, joinedAt: '2026-09-16T00:00:00.000Z' }]]);
    const out = await service.decorate([GROUP, MINE], 'tech-1', membership);
    expect(out.map((c) => [c.id, c.viewerUnread, c.viewerUnreadCount])).toEqual([
      ['g1', false, 0],
      ['c-me', true, 2],
    ]);
  });
});
