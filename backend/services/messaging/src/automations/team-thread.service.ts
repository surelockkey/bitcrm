import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Conversation } from '@bitcrm/types';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { AUTOMATIONS_ACTOR } from './automations.constants';

/**
 * The thread a technician's dispatch texts go to (design §6: Workiz `Tech`
 * → `kind: 'team'`, `partyKind: 'user'`, SMS to `User.phone`). Find-or-create
 * on `CONVOF#user#<id>`, the personal phone as the address so the reply
 * from that phone routes back into the same thread (`ADDR#`). A thread
 * opened earlier by an inbound text from the technician is reused; a phone
 * that changed since is added in front.
 */
@Injectable()
export class TeamThreadService {
  constructor(private readonly conversations: ConversationsRepository) {}

  async forTechnician(user: { id: string; phone?: string }): Promise<Conversation> {
    const existing = await this.conversations.getByParty('user', user.id);
    if (existing) return this.withPhone(existing, user.phone);

    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      kind: 'team',
      partyKind: 'user',
      partyId: user.id,
      addresses: { phones: user.phone ? [user.phone] : [], emails: [] },
      state: 'open',
      unread: false,
      unreadCount: 0,
      flagged: false,
      createdAt: now,
      updatedAt: now,
    };
    const { conversation: stored } = await this.conversations.findOrCreate({
      conversation,
      pointer: { kind: 'user', id: user.id },
      addresses: user.phone ? [{ address: user.phone, source: 'crm' }] : [],
    });
    return this.withPhone(stored, user.phone);
  }

  private async withPhone(conversation: Conversation, phone: string | undefined): Promise<Conversation> {
    if (!phone || conversation.addresses.phones.includes(phone)) return conversation;
    const at = new Date().toISOString();
    await this.conversations.putAddressPointer({
      address: phone,
      conversationId: conversation.id,
      partyKind: 'user',
      partyId: conversation.partyId,
      source: 'crm',
      updatedAt: at,
    });
    return this.conversations.update(
      conversation,
      { addresses: { phones: [phone, ...conversation.addresses.phones], emails: conversation.addresses.emails } },
      { actorId: AUTOMATIONS_ACTOR, at },
    );
  }
}
