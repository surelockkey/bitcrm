import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { TeamAccessService } from '../../../src/team/team-access.service';
import { TeamConversationsService, mergeMarkers } from '../../../src/team/team-conversations.service';
import { TeamCountersService } from '../../../src/team/team-counters.service';
import { StaleConversationError } from '../../../src/conversations/conversations.repository';
import { decodeCursor, encodeCursor } from '../../../src/common/cursor';
import { T0, T1, createMockConversation } from '../mocks';
import { ADMIN, TECH, adminPerms, mockConversationsRepo, techPerms } from '../api/api-mocks';

const OFFICE = adminPerms({ dataScope: { messages: 'all' as never, team_chat: 'all' as never } });
const OWN = techPerms({ dataScope: { messages: 'assigned_only' as never, team_chat: 'assigned_only' as never } });

const MINE = createMockConversation({
  id: 'c-me', kind: 'team', partyKind: 'user', partyId: 'tech-1',
  addresses: { phones: ['+14045550001'], emails: [] }, lastMessageAt: T1, lastMessageId: 'm9', lastDirection: 'outbound', unread: true, unreadCount: 1,
});
const OTHER = createMockConversation({ id: 'c-other', kind: 'team', partyKind: 'user', partyId: 'tech-2', addresses: { phones: [], emails: [] } });
const GROUP = createMockConversation({
  id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', name: 'Night shift', memberIds: ['tech-1', 'admin-1'],
  addresses: { phones: [], emails: [] }, lastMessageAt: T1, lastMessageId: 'm9', lastDirection: 'outbound',
});

function make() {
  const repo = mockConversationsRepo();
  const users = { find: jest.fn().mockResolvedValue({ id: 'tech-1', name: 'Ann Tech', phone: '+14045550001' }) };
  const events = { conversationUpdated: jest.fn() };
  const inboxCounters = { get: jest.fn().mockResolvedValue({ unreadConversations: 0, flaggedConversations: 0, unreadByKind: {} }) };
  const realtime = { conversationUpserted: jest.fn(), countersChanged: jest.fn() };
  const access = new TeamAccessService();
  const readState = new TeamCountersService(repo as never);
  const service = new TeamConversationsService(repo as never, access, readState, users as never, events as never, inboxCounters as never, realtime as never);
  return { service, repo, users, events, inboxCounters, realtime };
}

describe('TeamConversationsService.findOrCreateForUser', () => {
  it('opens the thread under CONVOF#user#<id> with the personal phone as address and ADDR# pointer', async () => {
    const { service, repo, users, realtime, events } = make();
    const { conversation, created } = await service.findOrCreateForUser('tech-1', ADMIN, OFFICE);

    expect(created).toBe(true);
    expect(users.find).toHaveBeenCalledWith('tech-1');
    const input = repo.findOrCreate.mock.calls[0][0] as any;
    expect(input.pointer).toEqual({ kind: 'user', id: 'tech-1' });
    expect(input.conversation).toMatchObject({
      kind: 'team', partyKind: 'user', partyId: 'tech-1', state: 'open', unread: false, unreadCount: 0, flagged: false,
      addresses: { phones: ['+14045550001'], emails: [] },
    });
    expect(input.addresses).toEqual([{ address: '+14045550001', source: 'crm' }]);
    expect(conversation.id).toBe(input.conversation.id);
    expect(realtime.conversationUpserted).toHaveBeenCalledWith(conversation, conversation.createdAt);
    expect(events.conversationUpdated).toHaveBeenCalledWith(conversation.id);
  });

  it('returns the existing thread without asking user-service, and opens one without a phone when the user has none', async () => {
    const { service, repo, users } = make();
    repo.getByParty.mockResolvedValueOnce(MINE);
    expect(await service.findOrCreateForUser('tech-1', ADMIN, OFFICE)).toEqual({ conversation: MINE, created: false });
    expect(users.find).not.toHaveBeenCalled();

    users.find.mockResolvedValueOnce({ id: 'tech-1', name: 'Ann' });
    await service.findOrCreateForUser('tech-1', ADMIN, OFFICE);
    const input = repo.findOrCreate.mock.calls[0][0] as any;
    expect(input.conversation.addresses).toEqual({ phones: [], emails: [] });
    expect(input.addresses).toEqual([]);
  });

  it('404s on an unknown user; needs team_chat.send; a technician may only open their own thread', async () => {
    const { service, users } = make();
    users.find.mockResolvedValueOnce(null);
    await expect(service.findOrCreateForUser('ghost', ADMIN, OFFICE)).rejects.toBeInstanceOf(NotFoundException);

    const noSend = adminPerms({ permissions: { ...OFFICE.permissions, team_chat: { view: true, send: false, manage_groups: true } } });
    await expect(service.findOrCreateForUser('tech-1', ADMIN, noSend)).rejects.toBeInstanceOf(ForbiddenException);

    await expect(service.findOrCreateForUser('tech-2', TECH, OWN)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.findOrCreateForUser('tech-1', TECH, OWN)).resolves.toMatchObject({ created: true });
  });
});

describe('TeamConversationsService.list', () => {
  it('the office reads the indexed category and passes the cursor through, rows decorated with its own read state', async () => {
    const { service, repo } = make();
    repo.listInbox.mockResolvedValue({ items: [MINE], nextCursor: 'N2' });
    repo.countMessagesAfter.mockResolvedValue(4);
    const page = await service.list({ kind: 'team', limit: 20, cursor: 'N1' }, ADMIN, OFFICE);

    expect(repo.listInbox).toHaveBeenCalledWith({ view: 'all', kind: 'team' }, { limit: 20, cursor: 'N1' });
    expect(repo.listMemberOf).not.toHaveBeenCalled();
    expect(page.nextCursor).toBe('N2');
    expect(page.items[0]).toMatchObject({ id: 'c-me', viewerUnread: true, viewerUnreadCount: 4 });

    await service.list({ kind: 'group', limit: 20 }, ADMIN, OFFICE);
    expect(repo.listInbox).toHaveBeenLastCalledWith({ view: 'all', kind: 'group' }, { limit: 20, cursor: undefined });
  });

  it('a technician gets their own thread or their groups, paged in memory with an offset cursor', async () => {
    const { service, repo } = make();
    repo.getByParty.mockResolvedValue(MINE);
    repo.listMemberOf.mockResolvedValue([
      { conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: T0 },
      { conversationId: 'g2', userId: 'tech-1', role: 'member', joinedAt: T0 },
    ]);
    repo.get.mockImplementation(async (id: string) => (id === 'g1' ? GROUP : id === 'g2' ? { ...GROUP, id: 'g2', lastMessageAt: T0 } : null));

    const teams = await service.list({ kind: 'team', limit: 10 }, TECH, OWN);
    expect(teams.items.map((c) => c.id)).toEqual(['c-me']);
    expect(repo.listInbox).not.toHaveBeenCalled();

    const first = await service.list({ kind: 'group', limit: 1 }, TECH, OWN);
    expect(first.items.map((c) => c.id)).toEqual(['g1']);
    expect(decodeCursor(first.nextCursor)).toEqual({ o: 1 });
    const second = await service.list({ kind: 'group', limit: 1, cursor: first.nextCursor }, TECH, OWN);
    expect(second.items.map((c) => c.id)).toEqual(['g2']);
    expect(second.nextCursor).toBeUndefined();

    await expect(service.list({ kind: 'group', limit: 1, cursor: encodeCursor({ o: 'x' }) }, TECH, OWN)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('TeamConversationsService.get / getParticipants', () => {
  it('returns the thread with the read state; a group also carries its roster with markers', async () => {
    const { service, repo } = make();
    repo.get.mockResolvedValue(GROUP);
    repo.getMember.mockResolvedValue({ conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: T0 });
    repo.listMembers.mockResolvedValue([
      { conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: T0 },
      { conversationId: 'g1', userId: 'admin-1', role: 'owner', joinedAt: T0 },
    ]);
    repo.listReadMarkers.mockResolvedValue([{ conversationId: 'g1', userId: 'admin-1', lastReadAt: T1, lastReadMessageSk: `MSG#${T1}#m9` }]);
    repo.countMessagesAfter.mockResolvedValue(5);

    const detail = await service.get('g1', TECH, OWN);
    expect(detail).toMatchObject({ id: 'g1', viewerUnread: true, viewerUnreadCount: 5 });
    expect(detail.members).toEqual([
      { conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: T0 },
      { conversationId: 'g1', userId: 'admin-1', role: 'owner', joinedAt: T0, lastReadAt: T1, lastReadMessageSk: `MSG#${T1}#m9` },
    ]);

    const participants = await service.getParticipants('g1', TECH, OWN);
    expect(participants.members).toHaveLength(2);
    expect(participants.readers).toHaveLength(1);
  });

  it('a 1:1 thread lists the employee as the member and the office markers as readers; 404 / 403 as the access service says', async () => {
    const { service, repo } = make();
    repo.get.mockResolvedValue(MINE);
    repo.listReadMarkers.mockResolvedValue([{ conversationId: 'c-me', userId: 'admin-1', lastReadAt: T1 }]);
    const p = await service.getParticipants('c-me', ADMIN, OFFICE);
    expect(p.members).toEqual([{ conversationId: 'c-me', userId: 'tech-1', role: 'member', joinedAt: T0 }]);
    expect(p.readers[0].userId).toBe('admin-1');

    repo.get.mockResolvedValue(createMockConversation());
    await expect(service.get('c1', ADMIN, OFFICE)).rejects.toBeInstanceOf(NotFoundException);
    repo.get.mockResolvedValue(OTHER);
    await expect(service.get('c-other', TECH, OWN)).rejects.toBeInstanceOf(ForbiddenException);
    repo.get.mockResolvedValue(null);
    await expect(service.get('nope', ADMIN, OFFICE)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('TeamConversationsService.markRead', () => {
  it('the office clears the team-wide unread through markRead and pushes the row plus counters', async () => {
    const { service, repo, realtime, inboxCounters, events } = make();
    repo.get.mockResolvedValue(MINE);
    repo.markRead.mockImplementation(async (c: typeof MINE) => ({ ...c, unread: false, unreadCount: 0, updatedAt: T1 }));

    const out = await service.markRead('c-me', `MSG#${T1}#m9`, ADMIN, OFFICE);
    expect(repo.markRead).toHaveBeenCalledWith(MINE, 'admin-1', expect.objectContaining({ lastReadMessageSk: `MSG#${T1}#m9` }));
    expect(repo.putReadMarker).not.toHaveBeenCalled();
    expect(out).toMatchObject({ unread: false, viewerUnread: false, viewerUnreadCount: 0, readMarker: { userId: 'admin-1', lastReadMessageSk: `MSG#${T1}#m9` } });
    expect(realtime.conversationUpserted).toHaveBeenCalled();
    expect(events.conversationUpdated).toHaveBeenCalledWith('c-me');
    await Promise.resolve();
    await Promise.resolve();
    expect(inboxCounters.get).toHaveBeenCalled();
    expect(realtime.countersChanged).toHaveBeenCalled();
  });

  it('the employee and group members only move their own READ# marker', async () => {
    const { service, repo, realtime } = make();
    repo.get.mockResolvedValue(MINE);
    const out = await service.markRead('c-me', undefined, TECH, OWN);
    expect(repo.markRead).not.toHaveBeenCalled();
    expect(repo.putReadMarker).toHaveBeenCalledWith('c-me', 'tech-1', expect.objectContaining({ lastReadMessageSk: undefined }));
    expect(out).toMatchObject({ unread: true, viewerUnread: false, readMarker: { userId: 'tech-1' } });
    expect(realtime.conversationUpserted).not.toHaveBeenCalled();

    repo.get.mockResolvedValue(GROUP);
    await service.markRead('g1', `MSG#${T1}#m9`, ADMIN, OFFICE);
    expect(repo.markRead).not.toHaveBeenCalled();
    expect(repo.putReadMarker).toHaveBeenLastCalledWith('g1', 'admin-1', expect.objectContaining({ lastReadMessageSk: `MSG#${T1}#m9` }));
  });

  it('re-reads when the office read loses the optimistic guard, 409 after three attempts', async () => {
    const { service, repo } = make();
    repo.get.mockResolvedValue(MINE);
    repo.markRead
      .mockRejectedValueOnce(new StaleConversationError('c-me'))
      .mockImplementationOnce(async (c: typeof MINE) => ({ ...c, unread: false, unreadCount: 0 }));
    await expect(service.markRead('c-me', undefined, ADMIN, OFFICE)).resolves.toMatchObject({ unread: false });
    expect(repo.get).toHaveBeenCalledTimes(2);

    repo.markRead.mockRejectedValue(new StaleConversationError('c-me'));
    await expect(service.markRead('c-me', undefined, ADMIN, OFFICE)).rejects.toMatchObject({ status: 409 });
  });
});

describe('TeamConversationsService.counters / mergeMarkers', () => {
  it('counters delegates to the read-state service for the caller', async () => {
    const { service } = make();
    expect(await service.counters(TECH)).toEqual({ unreadConversations: 0, unreadByKind: {} });
  });

  it('mergeMarkers folds a member’s own marker in and leaves others untouched', () => {
    const members = [{ conversationId: 'g1', userId: 'a', role: 'member' as const, joinedAt: T0 }, { conversationId: 'g1', userId: 'b', role: 'member' as const, joinedAt: T0 }];
    const merged = mergeMarkers(members, [{ conversationId: 'g1', userId: 'b', lastReadAt: T1 }]);
    expect(merged[0]).toEqual(members[0]);
    expect(merged[1]).toMatchObject({ userId: 'b', lastReadAt: T1 });
  });
});
