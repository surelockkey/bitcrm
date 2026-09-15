import { ConversationManagementController } from '../../../src/api/conversations/conversation-management.controller';
import { ConversationManagementService } from '../../../src/api/conversations/conversation-management.service';
import { createMockConversation, createMockMessage, T1 } from '../mocks';
import { ADMIN, adminPerms } from './api-mocks';

function make() {
  const conversation = createMockConversation({ id: 'c1', state: 'archived' });
  const management = {
    update: jest.fn().mockResolvedValue(conversation),
    markRead: jest.fn().mockResolvedValue({ ...conversation, unread: false }),
    archive: jest.fn().mockResolvedValue(conversation),
    unarchive: jest.fn().mockResolvedValue(conversation),
    flag: jest.fn().mockResolvedValue(conversation),
    unflag: jest.fn().mockResolvedValue(conversation),
    assign: jest.fn().mockResolvedValue(conversation),
    unassign: jest.fn().mockResolvedValue(conversation),
    setMessageFlag: jest.fn().mockResolvedValue(createMockMessage({ flagged: true })),
  } as unknown as ConversationManagementService;
  return { controller: new ConversationManagementController(management), management };
}

describe('ConversationManagementController', () => {
  const perms = adminPerms();

  it('PATCH /conversations/:id delegates the body and wraps', async () => {
    const { controller, management } = make();
    const res = await controller.update('c1', { state: 'archived' }, ADMIN, perms);
    expect(management.update).toHaveBeenCalledWith('c1', { state: 'archived' }, ADMIN, perms);
    expect(res).toEqual({ success: true, data: expect.objectContaining({ id: 'c1', state: 'archived' }) });
  });

  it('POST /conversations/:id/read passes lastReadMessageSk (body optional)', async () => {
    const { controller, management } = make();
    await controller.markRead('c1', { lastReadMessageSk: 'MSG#x#y' }, ADMIN, perms);
    expect(management.markRead).toHaveBeenCalledWith('c1', 'MSG#x#y', ADMIN, perms);
    await controller.markRead('c1', undefined as never, ADMIN, perms);
    expect(management.markRead).toHaveBeenLastCalledWith('c1', undefined, ADMIN, perms);
  });

  it('archive / unarchive / flag / unflag / assign / unassign', async () => {
    const { controller, management } = make();
    await controller.archive('c1', ADMIN, perms);
    await controller.unarchive('c1', ADMIN, perms);
    await controller.flag('c1', ADMIN, perms);
    await controller.unflag('c1', ADMIN, perms);
    await controller.assign('c1', { userId: 'u9' }, ADMIN, perms);
    await controller.unassign('c1', ADMIN, perms);
    for (const fn of ['archive', 'unarchive', 'flag', 'unflag', 'unassign'] as const) {
      expect((management as any)[fn]).toHaveBeenCalledWith('c1', ADMIN, perms);
    }
    expect(management.assign).toHaveBeenCalledWith('c1', 'u9', ADMIN, perms);
  });

  it('PATCH /conversations/:id/messages/:messageId', async () => {
    const { controller, management } = make();
    const res = await controller.setMessageFlag('c1', 'm1', { createdAt: T1, flagged: true }, ADMIN, perms);
    expect(management.setMessageFlag).toHaveBeenCalledWith('c1', 'm1', T1, true, ADMIN, perms);
    expect(res).toEqual({ success: true, data: expect.objectContaining({ id: 'm1', flagged: true }) });
  });
});
