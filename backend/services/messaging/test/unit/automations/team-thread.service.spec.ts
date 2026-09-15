import { type Conversation } from '@bitcrm/types';
import { AUTOMATIONS_ACTOR } from '../../../src/automations/automations.constants';
import { TeamThreadService } from '../../../src/automations/team-thread.service';
import { createMockConversation } from '../mocks';

function makeService(existing: Conversation | null = null) {
  const conversations = {
    getByParty: jest.fn(async () => existing),
    findOrCreate: jest.fn(async (input: { conversation: Conversation }) => ({ conversation: input.conversation, created: true })),
    putAddressPointer: jest.fn(async () => undefined),
    update: jest.fn(async (c: Conversation, patch: Partial<Conversation>) => ({ ...c, ...patch })),
  };
  return { service: new TeamThreadService(conversations as any), conversations };
}

describe('TeamThreadService.forTechnician', () => {
  it('opens a team thread for the user with the personal phone as its address', async () => {
    const { service, conversations } = makeService();
    const thread = await service.forTechnician({ id: 't1', phone: '+14045550001' });
    expect(thread).toMatchObject({ kind: 'team', partyKind: 'user', partyId: 't1', addresses: { phones: ['+14045550001'], emails: [] }, state: 'open' });
    expect(conversations.findOrCreate).toHaveBeenCalledWith(
      expect.objectContaining({ pointer: { kind: 'user', id: 't1' }, addresses: [{ address: '+14045550001', source: 'crm' }] }),
    );
    expect(conversations.update).not.toHaveBeenCalled();
  });

  it('reuses the existing thread and adds a changed phone in front, with its ADDR# row', async () => {
    const existing = createMockConversation({ id: 'c-t1', kind: 'team', partyKind: 'user', partyId: 't1', addresses: { phones: ['+14045550009'], emails: [] } });
    const { service, conversations } = makeService(existing);
    const thread = await service.forTechnician({ id: 't1', phone: '+14045550001' });
    expect(conversations.findOrCreate).not.toHaveBeenCalled();
    expect(conversations.putAddressPointer).toHaveBeenCalledWith(
      expect.objectContaining({ address: '+14045550001', conversationId: 'c-t1', partyKind: 'user', partyId: 't1', source: 'crm' }),
    );
    expect(conversations.update).toHaveBeenCalledWith(
      existing,
      { addresses: { phones: ['+14045550001', '+14045550009'], emails: [] } },
      expect.objectContaining({ actorId: AUTOMATIONS_ACTOR }),
    );
    expect(thread.addresses.phones).toEqual(['+14045550001', '+14045550009']);
  });

  it('leaves a thread that already carries the phone untouched', async () => {
    const existing = createMockConversation({ id: 'c-t1', kind: 'team', partyKind: 'user', partyId: 't1', addresses: { phones: ['+14045550001'], emails: [] } });
    const { service, conversations } = makeService(existing);
    expect(await service.forTechnician({ id: 't1', phone: '+14045550001' })).toBe(existing);
    expect(conversations.putAddressPointer).not.toHaveBeenCalled();
    expect(conversations.update).not.toHaveBeenCalled();
  });
});
