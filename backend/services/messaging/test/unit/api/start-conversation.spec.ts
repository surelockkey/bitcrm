import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConversationScopeService } from '../../../src/api/access/conversation-scope.service';
import { StartConversationController } from '../../../src/api/conversations/start-conversation.controller';
import { StartConversationService } from '../../../src/api/conversations/start-conversation.service';
import { createMockConversation } from '../mocks';
import { ADMIN, TECH, adminPerms, createMockDeal, mockConversationsRepo, mockDealRead, techPerms } from './api-mocks';

const CLIENT = createMockConversation({ id: 'c1', partyId: 'ct1' });
const TEAM = createMockConversation({ id: 'c-me', kind: 'team', partyKind: 'user', partyId: 'tech-1', addresses: { phones: ['+14045550001'], emails: [] } });

function make() {
  const repo = mockConversationsRepo();
  const deals = mockDealRead();
  const scope = new ConversationScopeService(repo as never, deals as never);
  const send = { conversationForParty: jest.fn().mockResolvedValue({ conversation: CLIENT, created: true }) };
  const team = { findOrCreateForUser: jest.fn().mockResolvedValue({ conversation: TEAM, created: false }) };
  const service = new StartConversationService(send as never, team as never, scope);
  return { service, send, team, deals };
}

describe('StartConversationService.start', () => {
  it('routes a user party to the team module and masks the teammate’s phone like any number', async () => {
    const { service, team, send } = make();
    const out = await service.start({ partyKind: 'user', partyId: 'tech-1' }, ADMIN, adminPerms());
    expect(team.findOrCreateForUser).toHaveBeenCalledWith('tech-1', ADMIN, adminPerms());
    expect(send.conversationForParty).not.toHaveBeenCalled();
    expect(out).toEqual({ conversation: TEAM, created: false });

    const masked = await service.start({ partyKind: 'user', partyId: 'tech-1' }, TECH, techPerms());
    expect(masked.conversation.addresses.phones).toEqual([]);
    expect(masked.conversation.phonesMasked).toBe(true);
  });

  it('routes contact / phone parties through the outbound find-or-create, then checks the messages scope', async () => {
    const { service, send, deals } = make();
    expect(await service.start({ partyKind: 'contact', partyId: 'ct1' }, ADMIN, adminPerms())).toEqual({ conversation: CLIENT, created: true });
    expect(send.conversationForParty).toHaveBeenCalledWith({ contactId: 'ct1', phone: undefined });

    await service.start({ contactId: 'ct1', phone: '+14045551234' }, ADMIN, adminPerms());
    expect(send.conversationForParty).toHaveBeenLastCalledWith({ contactId: 'ct1', phone: '+14045551234' });

    await expect(service.start({ phone: '+14045551234' }, TECH, techPerms())).rejects.toBeInstanceOf(ForbiddenException);
    deals.listByTech.mockResolvedValue([createMockDeal({ contactId: 'ct1' })]);
    const scoped = await service.start({ phone: '+14045551234' }, TECH, techPerms());
    expect(scoped.conversation.phonesMasked).toBe(true);
  });

  it('400s when nothing identifies the party', async () => {
    const { service } = make();
    await expect(service.start({}, ADMIN, adminPerms())).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('StartConversationController', () => {
  it('POST /conversations wraps the result', async () => {
    const service = { start: jest.fn().mockResolvedValue({ conversation: CLIENT, created: true }) } as unknown as StartConversationService;
    const controller = new StartConversationController(service);
    const perms = adminPerms();
    expect(await controller.start({ contactId: 'ct1' }, ADMIN, perms)).toEqual({ success: true, data: { conversation: CLIENT, created: true } });
    expect(service.start).toHaveBeenCalledWith({ contactId: 'ct1' }, ADMIN, perms);
  });
});
