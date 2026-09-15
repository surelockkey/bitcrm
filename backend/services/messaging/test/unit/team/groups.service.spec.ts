import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { GroupsService } from '../../../src/team/groups.service';
import { TeamAccessService } from '../../../src/team/team-access.service';
import { TeamConversationsService } from '../../../src/team/team-conversations.service';
import { TeamCountersService } from '../../../src/team/team-counters.service';
import { StaleConversationError } from '../../../src/conversations/conversations.repository';
import { T0, T1, createMockConversation } from '../mocks';
import { ADMIN, TECH, adminPerms, mockConversationsRepo, techPerms } from '../api/api-mocks';

const OFFICE = adminPerms({ dataScope: { messages: 'all' as never, team_chat: 'all' as never } });
const OWN = techPerms({ dataScope: { messages: 'assigned_only' as never, team_chat: 'assigned_only' as never } });

const GROUP = createMockConversation({
  id: 'g1', kind: 'group', partyKind: 'group', partyId: 'g1', name: 'Night shift', memberIds: ['admin-1', 'tech-1'],
  addresses: { phones: [], emails: [] }, createdBy: 'admin-1',
});

function make() {
  const repo = mockConversationsRepo();
  const users = { find: jest.fn(async (id: string) => (id.startsWith('ghost') ? null : { id, name: id })) };
  const events = { conversationUpdated: jest.fn() };
  const realtime = { conversationUpserted: jest.fn(), countersChanged: jest.fn(), teamCountersInvalidated: jest.fn() };
  const access = new TeamAccessService();
  const readState = new TeamCountersService(repo as never);
  const team = new TeamConversationsService(repo as never, access, readState, users as never, events as never, undefined, realtime as never);
  const service = new GroupsService(repo as never, access, team, readState, users as never, events as never, realtime as never);
  return { service, repo, users, events, realtime };
}

describe('GroupsService.create', () => {
  it('validates the members, adds the creator as owner and writes the group in one transaction', async () => {
    const { service, repo, users, realtime, events } = make();
    const out = await service.create({ name: '  Night shift ', memberIds: ['tech-1', 'tech-2', 'tech-1'] }, ADMIN, OFFICE);

    expect(users.find).toHaveBeenCalledTimes(2);
    expect(users.find).not.toHaveBeenCalledWith('admin-1');
    const [conversation, members] = repo.createGroup.mock.calls[0] as [any, any[]];
    expect(conversation).toMatchObject({
      kind: 'group', partyKind: 'group', partyId: conversation.id, name: 'Night shift', createdBy: 'admin-1',
      state: 'open', unread: false, unreadCount: 0, flagged: false, addresses: { phones: [], emails: [] },
    });
    expect(members).toEqual([
      { conversationId: conversation.id, userId: 'admin-1', role: 'owner', joinedAt: conversation.createdAt },
      { conversationId: conversation.id, userId: 'tech-1', role: 'member', joinedAt: conversation.createdAt },
      { conversationId: conversation.id, userId: 'tech-2', role: 'member', joinedAt: conversation.createdAt },
    ]);
    expect(out).toMatchObject({ id: conversation.id, memberIds: ['admin-1', 'tech-1', 'tech-2'], viewerUnread: false, viewerUnreadCount: 0 });
    expect(out.members).toHaveLength(3);
    expect(realtime.conversationUpserted).toHaveBeenCalled();
    expect(events.conversationUpdated).toHaveBeenCalledWith(conversation.id);
  });

  it('names unknown users in a 400 and caps the roster at 99', async () => {
    const { service, repo } = make();
    await expect(service.create({ name: 'x', memberIds: ['tech-1', 'ghost-1', 'ghost-2'] }, ADMIN, OFFICE)).rejects.toMatchObject({
      status: 400,
      message: 'Unknown users: ghost-1, ghost-2',
    });
    expect(repo.createGroup).not.toHaveBeenCalled();

    const many = Array.from({ length: 99 }, (_, i) => `u${i}`);
    await expect(service.create({ name: 'x', memberIds: many }, ADMIN, OFFICE)).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('GroupsService.get / list', () => {
  it('returns header, read state and roster; 404 when the id is a 1:1 thread; 403 for a non-member technician', async () => {
    const { service, repo } = make();
    repo.get.mockResolvedValue({ ...GROUP, lastMessageAt: T1, lastMessageId: 'm1' });
    repo.listMembers.mockResolvedValue([{ conversationId: 'g1', userId: 'tech-1', role: 'member', joinedAt: T0 }]);
    const marker = { conversationId: 'g1', userId: 'tech-1', lastReadAt: T1, lastReadMessageSk: `MSG#${T1}#m1` };
    repo.listReadMarkers.mockResolvedValue([marker]);
    repo.getReadMarker.mockResolvedValue(marker);
    const out = await service.get('g1', TECH, OWN);
    expect(out).toMatchObject({ id: 'g1', viewerUnread: false, members: [{ userId: 'tech-1', lastReadAt: T1 }] });

    repo.get.mockResolvedValue(createMockConversation({ kind: 'team', partyKind: 'user', partyId: 'admin-1' }));
    await expect(service.get('c-x', ADMIN, OFFICE)).rejects.toBeInstanceOf(NotFoundException);

    repo.get.mockResolvedValue({ ...GROUP, memberIds: ['admin-1'] });
    await expect(service.get('g1', TECH, OWN)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('list is the team list narrowed to groups', async () => {
    const { service, repo } = make();
    repo.listInbox.mockResolvedValue({ items: [GROUP] });
    const page = await service.list({ limit: 10 }, ADMIN, OFFICE);
    expect(repo.listInbox).toHaveBeenCalledWith({ view: 'all', kind: 'group' }, { limit: 10, cursor: undefined });
    expect(page.items[0].id).toBe('g1');
  });
});

describe('GroupsService.update', () => {
  function current() {
    return { ...GROUP, memberIds: ['admin-1', 'tech-1', 'tech-2'] };
  }

  it('adds new members, removes present ones, renames — validated, in one call', async () => {
    const { service, repo, users, realtime } = make();
    repo.get.mockResolvedValue(current());
    repo.updateMembers.mockImplementation(async (c: any, change: any) => ({ ...c, memberIds: ['admin-1', 'tech-1', 'tech-3'], name: change.name ?? c.name, updatedAt: T1 }));
    repo.listMembers.mockResolvedValue([]);

    const out = await service.update('g1', { name: 'Day shift', addMemberIds: ['tech-3', 'tech-1'], removeMemberIds: ['tech-2', 'not-here'] }, ADMIN, OFFICE);

    expect(users.find).toHaveBeenCalledWith('tech-3');
    const [c, change, opts] = repo.updateMembers.mock.calls[0] as [any, any, any];
    expect(c.id).toBe('g1');
    expect(change.add).toEqual([{ conversationId: 'g1', userId: 'tech-3', role: 'member', joinedAt: expect.any(String) }]);
    expect(change.remove).toEqual(['tech-2']);
    expect(change.name).toBe('Day shift');
    expect(opts.actorId).toBe('admin-1');
    expect(out).toMatchObject({ name: 'Day shift', memberIds: ['admin-1', 'tech-1', 'tech-3'] });
    expect(realtime.conversationUpserted).toHaveBeenCalled();
    expect(realtime.teamCountersInvalidated).toHaveBeenCalledWith('g1', ['tech-3', 'tech-2'], expect.any(String));
  });

  it('refuses a blank name, an id in both lists, unknown users, and emptying the group', async () => {
    const { service, repo } = make();
    repo.get.mockResolvedValue(current());
    await expect(service.update('g1', { name: '  ' }, ADMIN, OFFICE)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('g1', { addMemberIds: ['a'], removeMemberIds: ['a'] }, ADMIN, OFFICE)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('g1', { addMemberIds: ['ghost'] }, ADMIN, OFFICE)).rejects.toMatchObject({ status: 400 });
    await expect(service.update('g1', { removeMemberIds: ['admin-1', 'tech-1', 'tech-2'] }, ADMIN, OFFICE)).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.updateMembers).not.toHaveBeenCalled();
  });

  it('a no-op change publishes nothing; a technician with manage_groups may only touch their own groups', async () => {
    const { service, repo, realtime } = make();
    const c = current();
    repo.get.mockResolvedValue(c);
    repo.updateMembers.mockResolvedValue(c);
    await service.update('g1', { name: 'Night shift' }, ADMIN, OFFICE);
    expect(realtime.conversationUpserted).not.toHaveBeenCalled();

    repo.get.mockResolvedValue({ ...c, memberIds: ['admin-1'] });
    await expect(service.update('g1', { name: 'x' }, TECH, OWN)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('re-reads after a stale guard and answers 409 when it keeps losing', async () => {
    const { service, repo } = make();
    repo.get.mockResolvedValue(current());
    repo.updateMembers.mockRejectedValueOnce(new StaleConversationError('g1')).mockImplementationOnce(async (c: any) => ({ ...c, name: 'x' }));
    await expect(service.update('g1', { name: 'x' }, ADMIN, OFFICE)).resolves.toMatchObject({ name: 'x' });
    expect(repo.get).toHaveBeenCalledTimes(2);

    repo.updateMembers.mockRejectedValue(new StaleConversationError('g1'));
    await expect(service.update('g1', { name: 'y' }, ADMIN, OFFICE)).rejects.toMatchObject({ status: 409 });
  });
});
