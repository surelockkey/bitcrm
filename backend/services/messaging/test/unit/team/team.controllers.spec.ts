import { GroupsController } from '../../../src/team/groups.controller';
import { GroupsService } from '../../../src/team/groups.service';
import { TeamController } from '../../../src/team/team.controller';
import { TeamConversationsService } from '../../../src/team/team-conversations.service';
import { createMockConversation } from '../mocks';
import { ADMIN, adminPerms } from '../api/api-mocks';

/** Thin controllers: validate → delegate → wrap. These lock the envelope. */
const view = { ...createMockConversation({ id: 'g1', kind: 'group' }), viewerUnread: true, viewerUnreadCount: 2 };

describe('TeamController', () => {
  const team = {
    list: jest.fn().mockResolvedValue({ items: [view], nextCursor: 'N1' }),
    counters: jest.fn().mockResolvedValue({ unreadConversations: 1, unreadByKind: { group: 1 } }),
    get: jest.fn().mockResolvedValue(view),
    getParticipants: jest.fn().mockResolvedValue({ members: [], readers: [] }),
    markRead: jest.fn().mockResolvedValue({ ...view, viewerUnread: false }),
  } as unknown as TeamConversationsService;
  const controller = new TeamController(team);
  const perms = adminPerms();

  it('GET /team/conversations wraps the page with pagination', async () => {
    const res = await controller.list({ kind: 'group', limit: 10, cursor: 'C' }, ADMIN, perms);
    expect(team.list).toHaveBeenCalledWith({ kind: 'group', limit: 10, cursor: 'C' }, ADMIN, perms);
    expect(res).toEqual({ success: true, data: [view], pagination: { nextCursor: 'N1', count: 1 } });
  });

  it('GET /team/counters, GET /team/conversations/:id(/participants), POST …/read delegate and wrap', async () => {
    expect(await controller.counters(ADMIN)).toEqual({ success: true, data: { unreadConversations: 1, unreadByKind: { group: 1 } } });
    expect((await controller.get('g1', ADMIN, perms)).data).toBe(view);
    expect(team.get).toHaveBeenCalledWith('g1', ADMIN, perms);
    expect((await controller.participants('g1', ADMIN, perms)).data).toEqual({ members: [], readers: [] });
    expect((await controller.markRead('g1', { lastReadMessageSk: 'MSG#x' }, ADMIN, perms)).data).toMatchObject({ viewerUnread: false });
    expect(team.markRead).toHaveBeenCalledWith('g1', 'MSG#x', ADMIN, perms);
  });
});

describe('GroupsController', () => {
  const groups = {
    create: jest.fn().mockResolvedValue({ ...view, members: [] }),
    list: jest.fn().mockResolvedValue({ items: [view] }),
    get: jest.fn().mockResolvedValue({ ...view, members: [] }),
    update: jest.fn().mockResolvedValue({ ...view, name: 'x', members: [] }),
  } as unknown as GroupsService;
  const controller = new GroupsController(groups);
  const perms = adminPerms();

  it('POST / GET / GET :id / PATCH :id delegate and wrap', async () => {
    const dto = { name: 'x', memberIds: ['a'] };
    expect((await controller.create(dto, ADMIN, perms)).success).toBe(true);
    expect(groups.create).toHaveBeenCalledWith(dto, ADMIN, perms);

    expect(await controller.list({ limit: 5 }, ADMIN, perms)).toEqual({ success: true, data: [view], pagination: { nextCursor: undefined, count: 1 } });
    expect((await controller.get('g1', ADMIN, perms)).data).toMatchObject({ id: 'g1' });
    expect((await controller.update('g1', { name: 'x' }, ADMIN, perms)).data).toMatchObject({ name: 'x' });
    expect(groups.update).toHaveBeenCalledWith('g1', { name: 'x' }, ADMIN, perms);
  });
});
