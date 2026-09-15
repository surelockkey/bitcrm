import { ConflictException, ForbiddenException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { ConversationManagementService } from '../../../src/api/conversations/conversation-management.service';
import { ConversationsService } from '../../../src/api/conversations/conversations.service';
import { StaleConversationError } from '../../../src/conversations/conversations.repository';
import { createMockConversation, createMockMessage, T1 } from '../mocks';
import {
  ADMIN,
  TECH,
  adminPerms,
  createMockDeal,
  mockConversationsRepo,
  mockDealRead,
  mockMessagesRepo,
  mockOptOutsRepo,
  techPerms,
} from './api-mocks';

function make() {
  const repo = mockConversationsRepo();
  const messages = mockMessagesRepo();
  const deals = mockDealRead();
  const users = { find: jest.fn().mockResolvedValue({ id: 'u9', name: 'Tamir Levi' }) };
  const events = { conversationUpdated: jest.fn() };
  const scope = new ConversationScopeService(repo as never, deals as never);
  const reads = new ConversationsService(repo as never, mockOptOutsRepo() as never, scope, deals as never);
  const svc = new ConversationManagementService(repo as never, messages as never, reads, scope, users as never, events as never);
  // Default: the repository applies the patch and stamps a new updatedAt.
  repo.update.mockImplementation(async (current, patch) => ({ ...current, ...patch, updatedAt: '2026-09-15T12:00:00.000Z' }));
  repo.markRead.mockImplementation(async (current) => ({ ...current, unread: false, unreadCount: 0, updatedAt: '2026-09-15T12:00:00.000Z' }));
  return { svc, repo, messages, deals, users, events };
}

const OPEN = createMockConversation({ id: 'c1', unread: true, unreadCount: 2 });

describe('ConversationManagementService.update', () => {
  it('maps the DTO to a repository patch with the actor and publishes conversation.updated', async () => {
    const { svc, repo, events } = make();
    repo.get.mockResolvedValue(OPEN);
    const res = await svc.update('c1', { state: 'archived', flagged: true, categoryId: null }, ADMIN, adminPerms());
    expect(repo.update).toHaveBeenCalledWith(OPEN, { state: 'archived', flagged: true, categoryId: null }, { actorId: 'admin-1' });
    expect(res.state).toBe('archived');
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('publishes nothing when the patch changed nothing (repository returned the same object)', async () => {
    const { svc, repo, events } = make();
    repo.get.mockResolvedValue(OPEN);
    repo.update.mockImplementation(async (current) => current);
    await svc.update('c1', { flagged: false }, ADMIN, adminPerms());
    expect(events.conversationUpdated).not.toHaveBeenCalled();
  });

  it('validates assignedUserId through user-service before touching the row', async () => {
    const { svc, repo, users } = make();
    repo.get.mockResolvedValue(OPEN);
    users.find.mockResolvedValue(null);
    await expect(svc.update('c1', { assignedUserId: 'ghost' }, ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
    // null unassigns without a lookup
    users.find.mockClear();
    await svc.update('c1', { assignedUserId: null }, ADMIN, adminPerms());
    expect(users.find).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenCalledWith(OPEN, { assignedUserId: null }, { actorId: 'admin-1' });
  });

  it('404 when the conversation is missing, 403 outside the technician’s scope', async () => {
    const { svc, repo } = make();
    await expect(svc.update('c1', { flagged: true }, ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
    repo.get.mockResolvedValue(OPEN);
    await expect(svc.update('c1', { flagged: true }, TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('re-reads and retries a stale guard, then gives up with 409', async () => {
    const { svc, repo, events } = make();
    const fresh = { ...OPEN, updatedAt: T1 };
    repo.get.mockResolvedValueOnce(OPEN).mockResolvedValueOnce(fresh);
    repo.update
      .mockRejectedValueOnce(new StaleConversationError('c1'))
      .mockImplementationOnce(async (current, patch) => ({ ...current, ...patch }));
    const res = await svc.flag('c1', ADMIN, adminPerms());
    expect(repo.update).toHaveBeenNthCalledWith(2, fresh, { flagged: true }, { actorId: 'admin-1' });
    expect(res.flagged).toBe(true);
    expect(events.conversationUpdated).toHaveBeenCalledTimes(1);

    repo.get.mockResolvedValue(OPEN);
    repo.update.mockRejectedValue(new StaleConversationError('c1'));
    await expect(svc.flag('c1', ADMIN, adminPerms())).rejects.toBeInstanceOf(ConflictException);
    expect(repo.get).toHaveBeenCalledTimes(2 + 3);
  });

  it('masks the result for a viewer without contacts.view_numbers', async () => {
    const { svc, repo, deals } = make();
    repo.get.mockResolvedValue(OPEN);
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    const res = await svc.markRead('c1', undefined, TECH, techPerms());
    expect(res.phonesMasked).toBe(true);
  });
});

describe('ConversationManagementService shortcuts', () => {
  it('archive / unarchive / flag / unflag / assign / unassign are the matching patches', async () => {
    const { svc, repo, users } = make();
    repo.get.mockResolvedValue(OPEN);
    const perms = adminPerms();
    await svc.archive('c1', ADMIN, perms);
    await svc.unarchive('c1', ADMIN, perms);
    await svc.flag('c1', ADMIN, perms);
    await svc.unflag('c1', ADMIN, perms);
    await svc.assign('c1', 'u9', ADMIN, perms);
    await svc.unassign('c1', ADMIN, perms);
    expect(repo.update.mock.calls.map((c) => c[1])).toEqual([
      { state: 'archived' },
      { state: 'open' },
      { flagged: true },
      { flagged: false },
      { assignedUserId: 'u9' },
      { assignedUserId: null },
    ]);
    expect(users.find).toHaveBeenCalledWith('u9');
  });

  it('assign: unknown user → 404, user-service down → 503, nothing written', async () => {
    const { svc, repo, users } = make();
    repo.get.mockResolvedValue(OPEN);
    users.find.mockResolvedValue(null);
    await expect(svc.assign('c1', 'ghost', ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
    users.find.mockRejectedValue(new ServiceUnavailableException());
    await expect(svc.assign('c1', 'u9', ADMIN, adminPerms())).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('ConversationManagementService.markRead', () => {
  it('writes the READ# marker with lastReadMessageSk for the caller and publishes', async () => {
    const { svc, repo, events } = make();
    repo.get.mockResolvedValue(OPEN);
    const res = await svc.markRead('c1', 'MSG#2026-09-15T10:05:00.000Z#m1', ADMIN, adminPerms());
    expect(repo.markRead).toHaveBeenCalledWith(OPEN, 'admin-1', { lastReadMessageSk: 'MSG#2026-09-15T10:05:00.000Z#m1' });
    expect(res.unread).toBe(false);
    expect(res.unreadCount).toBe(0);
    expect(events.conversationUpdated).toHaveBeenCalledWith('c1');
  });

  it('a technician may mark their own job’s thread read', async () => {
    const { svc, repo, deals } = make();
    repo.get.mockResolvedValue(OPEN);
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    await expect(svc.markRead('c1', undefined, TECH, techPerms())).resolves.toMatchObject({ unread: false });
    deals.listByTech.mockResolvedValue([]);
    await expect(svc.markRead('c1', undefined, TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe('ConversationManagementService.setMessageFlag', () => {
  const KEY = { conversationId: 'c1', createdAt: T1, messageId: 'm1' };

  it('flags an existing message with the actor and returns it as written', async () => {
    const { svc, repo, messages, events } = make();
    repo.get.mockResolvedValue(OPEN);
    messages.get.mockResolvedValue(createMockMessage());
    const res = await svc.setMessageFlag('c1', 'm1', T1, true, ADMIN, adminPerms());
    expect(messages.get).toHaveBeenCalledWith(KEY);
    expect(messages.setFlagged).toHaveBeenCalledWith(KEY, true, 'admin-1', expect.any(String));
    expect(res).toMatchObject({ id: 'm1', flagged: true, flaggedBy: 'admin-1' });
    expect(res.flaggedAt).toEqual(expect.any(String));
    // the conversation row did not change → nothing for search
    expect(events.conversationUpdated).not.toHaveBeenCalled();
  });

  it('unflag clears the flag fields', async () => {
    const { svc, repo, messages } = make();
    repo.get.mockResolvedValue(OPEN);
    messages.get.mockResolvedValue(createMockMessage({ flagged: true, flaggedAt: T1, flaggedBy: 'u1' }));
    const res = await svc.setMessageFlag('c1', 'm1', T1, false, ADMIN, adminPerms());
    expect(messages.setFlagged).toHaveBeenCalledWith(KEY, false, 'admin-1', expect.any(String));
    expect(res.flagged).toBe(false);
    expect(res.flaggedAt).toBeUndefined();
    expect(res.flaggedBy).toBeUndefined();
  });

  it('404 on a missing message, 403 outside scope, and masks the result', async () => {
    const { svc, repo, messages, deals } = make();
    repo.get.mockResolvedValue(OPEN);
    await expect(svc.setMessageFlag('c1', 'm1', T1, true, ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
    expect(messages.setFlagged).not.toHaveBeenCalled();

    messages.get.mockResolvedValue(createMockMessage());
    await expect(svc.setMessageFlag('c1', 'm1', T1, true, TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);

    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    const res = await svc.setMessageFlag('c1', 'm1', T1, true, TECH, techPerms());
    expect(res.fromMasked).toBe(true);
  });
});
