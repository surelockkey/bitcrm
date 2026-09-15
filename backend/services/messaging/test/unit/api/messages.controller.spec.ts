import { MessagesController } from '../../../src/api/messages/messages.controller';
import { MessagesService } from '../../../src/api/messages/messages.service';
import { createMockMessage } from '../mocks';
import { ADMIN, adminPerms } from './api-mocks';

function make() {
  const messages = {
    listByConversation: jest.fn().mockResolvedValue({ items: [createMockMessage()], nextCursor: 'OLDER' }),
    listByJob: jest.fn().mockResolvedValue({ items: [], nextCursor: undefined }),
    listFlagged: jest.fn().mockResolvedValue({ items: [createMockMessage({ flagged: true })] }),
  } as unknown as MessagesService;
  return { controller: new MessagesController(messages), messages };
}

describe('MessagesController', () => {
  it('GET /conversations/:id/messages — envelope with the "load older" cursor', async () => {
    const { controller, messages } = make();
    const perms = adminPerms();
    const res = await controller.byConversation('c1', { limit: 50, cursor: 'K' }, ADMIN, perms);
    expect(messages.listByConversation).toHaveBeenCalledWith('c1', { limit: 50, cursor: 'K' }, ADMIN, perms);
    expect(res).toEqual({
      success: true,
      data: [expect.objectContaining({ id: 'm1' })],
      pagination: { nextCursor: 'OLDER', count: 1 },
    });
  });

  it('GET /messages/by-job/:dealId — empty page has count 0 and no cursor', async () => {
    const { controller } = make();
    expect(await controller.byJob('d1', { limit: 50 }, ADMIN, adminPerms())).toEqual({
      success: true,
      data: [],
      pagination: { nextCursor: undefined, count: 0 },
    });
  });

  it('GET /messages/flagged', async () => {
    const { controller, messages } = make();
    const res = await controller.flagged({ limit: 10 }, ADMIN, adminPerms());
    expect(messages.listFlagged).toHaveBeenCalledWith({ limit: 10 }, ADMIN, adminPerms());
    expect(res.pagination).toEqual({ nextCursor: undefined, count: 1 });
  });
});
