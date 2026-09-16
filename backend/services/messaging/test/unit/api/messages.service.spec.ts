import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { ConversationsService } from '../../../src/api/conversations/conversations.service';
import { MessagesService } from '../../../src/api/messages/messages.service';
import { InvalidCursorError } from '../../../src/common/cursor';
import { createMockConversation, createMockMessage } from '../mocks';
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
  const conversations = mockConversationsRepo();
  const messages = mockMessagesRepo();
  const deals = mockDealRead();
  const scope = new ConversationScopeService(conversations as never, deals as never);
  const conversationsService = new ConversationsService(conversations as never, mockOptOutsRepo() as never, scope, deals as never);
  const svc = new MessagesService(messages as never, conversationsService, scope);
  return { svc, conversations, messages, deals };
}

describe('MessagesService.listByConversation', () => {
  it('checks the conversation first, then pages the feed with the cursor passed through', async () => {
    const { svc, conversations, messages } = make();
    conversations.get.mockResolvedValue(createMockConversation());
    messages.listByConversation.mockResolvedValue({ items: [createMockMessage()], nextCursor: 'OLDER' });

    const page = await svc.listByConversation('c1', { limit: 30, cursor: 'K1' }, ADMIN, adminPerms());
    expect(messages.listByConversation).toHaveBeenCalledWith('c1', { limit: 30, cursor: 'K1' });
    expect(page.nextCursor).toBe('OLDER');
    expect(page.items[0].from).toBe('+14045551234');
  });

  it('404 on a missing conversation, 403 outside scope — without reading the feed', async () => {
    const { svc, conversations, messages } = make();
    await expect(svc.listByConversation('c1', { limit: 50 }, ADMIN, adminPerms())).rejects.toBeInstanceOf(NotFoundException);
    conversations.get.mockResolvedValue(createMockConversation({ partyId: 'ct-other' }));
    await expect(svc.listByConversation('c1', { limit: 50 }, TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);
    expect(messages.listByConversation).not.toHaveBeenCalled();
  });

  it('masks the client number for a technician and maps a bad cursor to 400', async () => {
    const { svc, conversations, messages, deals } = make();
    conversations.get.mockResolvedValue(createMockConversation({ partyId: 'ct1' }));
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    messages.listByConversation.mockResolvedValue({ items: [createMockMessage()] });

    const page = await svc.listByConversation('c1', { limit: 50 }, TECH, techPerms());
    expect(page.items[0].from).toBeUndefined();
    expect(page.items[0].fromMasked).toBe(true);

    messages.listByConversation.mockRejectedValue(new InvalidCursorError());
    await expect(svc.listByConversation('c1', { limit: 50, cursor: 'x' }, TECH, techPerms())).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MessagesService.listInternal', () => {
  it('pages the feed raw — no scope check, no masking, cursor passed through', async () => {
    const { svc, conversations, messages } = make();
    messages.listByConversation.mockResolvedValue({ items: [createMockMessage()], nextCursor: 'OLDER' });

    const page = await svc.listInternal('c1', { limit: 20, cursor: 'K1' });
    expect(messages.listByConversation).toHaveBeenCalledWith('c1', { limit: 20, cursor: 'K1' });
    expect(conversations.get).not.toHaveBeenCalled();
    expect(page.nextCursor).toBe('OLDER');
    expect(page.items[0].from).toBe('+14045551234');
    expect((page.items[0] as { fromMasked?: true }).fromMasked).toBeUndefined();
  });

  it('maps a bad cursor to 400', async () => {
    const { svc, messages } = make();
    messages.listByConversation.mockRejectedValue(new InvalidCursorError());
    await expect(svc.listInternal('c1', { limit: 20, cursor: 'x' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('MessagesService.listByJob', () => {
  it('reads JobIndex for a full-scope caller', async () => {
    const { svc, messages } = make();
    messages.listByJob.mockResolvedValue({ items: [createMockMessage({ dealId: 'd1' })], nextCursor: 'N' });
    const page = await svc.listByJob('d1', { limit: 20 }, ADMIN, adminPerms());
    expect(messages.listByJob).toHaveBeenCalledWith('d1', { limit: 20 });
    expect(page.nextCursor).toBe('N');
  });

  it('requires the technician to be on the job', async () => {
    const { svc, messages, deals } = make();
    deals.find.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-2'] }));
    await expect(svc.listByJob('d1', { limit: 20 }, TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);
    expect(messages.listByJob).not.toHaveBeenCalled();

    deals.find.mockResolvedValue(createMockDeal({ assignedTechIds: ['tech-1'] }));
    messages.listByJob.mockResolvedValue({ items: [createMockMessage()] });
    const page = await svc.listByJob('d1', { limit: 20 }, TECH, techPerms());
    expect(page.items[0].fromMasked).toBe(true);
  });
});

describe('MessagesService.listFlagged', () => {
  it('returns the company-wide flagged feed for full scope', async () => {
    const { svc, messages } = make();
    messages.listFlagged.mockResolvedValue({ items: [createMockMessage({ flagged: true })], nextCursor: 'Y' });
    const page = await svc.listFlagged({ limit: 10, cursor: 'X' }, ADMIN, adminPerms());
    expect(messages.listFlagged).toHaveBeenCalledWith({ limit: 10, cursor: 'X' });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe('Y');
  });

  it('keeps only the technician’s threads', async () => {
    const { svc, messages, conversations, deals } = make();
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    conversations.getByParty.mockImplementation(async (kind: string, id: string) =>
      kind === 'contact' && id === 'ct1' ? createMockConversation({ id: 'c1' }) : null,
    );
    messages.listFlagged.mockResolvedValue({
      items: [createMockMessage({ id: 'm1', conversationId: 'c1' }), createMockMessage({ id: 'm2', conversationId: 'c-other' })],
    });
    const page = await svc.listFlagged({ limit: 10 }, TECH, techPerms());
    expect(page.items.map((m) => m.id)).toEqual(['m1']);
  });
});
