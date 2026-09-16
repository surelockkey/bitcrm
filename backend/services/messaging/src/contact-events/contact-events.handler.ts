import { Injectable, Logger } from '@nestjs/common';
import { tryNormalizePhone } from '@bitcrm/shared';
import { type Conversation, type ConversationAddressPointer } from '@bitcrm/types';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { CrmContactsClient } from '../outbound/internal/crm-contacts.client';
import { ContactPointersRepository } from './contact-pointers.repository';
import {
  isContactMergedPayload,
  isContactUpdatedPayload,
  type ContactMergedPayload,
  type ContactUpdatedPayload,
} from './contact-events.payloads';

/** `archivedBy` / actor stamp on the rows this consumer rewrites. */
export const CONTACT_EVENTS_ACTOR = 'system:contact-events';

const uniq = (values: string[]) => [...new Set(values)];
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/**
 * Keeps the pointer rows in step with CRM (design §7.3, EVENTS.md):
 *
 *   contact.merged   the duplicate's thread is handed to the survivor —
 *                    `CONVOF#contact#<survivor>` → that thread, its `partyId`
 *                    and every `ADDR#` row it owns re-labelled, the
 *                    duplicate's `CONVOF#` key dropped. When the survivor
 *                    already has a thread, that one absorbs the duplicate's
 *                    addresses (so the numbers keep routing inbound), and the
 *                    duplicate's thread is re-labelled and archived: its
 *                    messages stay readable, a message-level merge of the two
 *                    partitions is a later milestone.
 *   contact.updated  the contact's phones/emails are re-read from CRM and the
 *                    `ADDR#` rows plus `conversation.addresses` follow them:
 *                    added → pointer written, removed → pointer dropped (only
 *                    when it still points at this thread).
 *
 * Every step re-reads before it writes and is a no-op when the state is
 * already what it would produce, so an SQS redelivery (the consumer does not
 * deduplicate) and the crm's own `contact.updated` after a merge land safely
 * in any order. A `StaleConversationError` propagates: SQS retries.
 */
@Injectable()
export class ContactEventsHandler {
  private readonly logger = new Logger(ContactEventsHandler.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly pointers: ContactPointersRepository,
    private readonly crm: CrmContactsClient,
  ) {}

  // ------------------------------------------------------ contact.merged

  async onContactMerged(payload: unknown): Promise<void> {
    if (!isContactMergedPayload(payload)) {
      this.logger.warn(`Dropping malformed contact.merged payload: ${JSON.stringify(payload)}`);
      return;
    }
    await this.merge(payload);
  }

  async merge({ oldContactId, newContactId }: ContactMergedPayload): Promise<void> {
    if (oldContactId === newContactId) return;

    const oldPointer = await this.conversations.getPointer('contact', oldContactId);
    if (!oldPointer) {
      this.logger.log(`contact.merged ${oldContactId} → ${newContactId}: no thread to re-point`);
      return;
    }
    const duplicate = await this.conversations.get(oldPointer.conversationId);
    if (!duplicate) {
      // Dangling key (the thread is gone): nothing to hand over, drop the key.
      await this.pointers.removePartyPointer('contact', oldContactId, oldPointer.conversationId);
      return;
    }

    const survivorPointer = await this.conversations.getPointer('contact', newContactId);
    const survivor =
      survivorPointer && survivorPointer.conversationId !== duplicate.id
        ? await this.conversations.get(survivorPointer.conversationId)
        : null;

    if (!survivor) {
      // The survivor has no thread of its own (or a dangling key): the duplicate's thread becomes theirs.
      const claimed = await this.pointers.putPartyPointer('contact', newContactId, duplicate.id, oldPointer.createdAt);
      if (!claimed) {
        // Somebody opened a thread for the survivor between our read and the put: merge into that one.
        const fresh = await this.conversations.getByParty('contact', newContactId);
        if (fresh && fresh.id !== duplicate.id) {
          await this.absorb(duplicate, fresh, newContactId);
        } else {
          await this.relabel(duplicate, newContactId);
        }
      } else {
        await this.relabel(duplicate, newContactId);
      }
    } else {
      await this.absorb(duplicate, survivor, newContactId);
    }

    await this.pointers.removePartyPointer('contact', oldContactId, duplicate.id);
    this.logger.log(`contact.merged: thread ${duplicate.id} of ${oldContactId} now belongs to ${newContactId}`);
  }

  /** The thread keeps its messages and addresses; only the party label changes. */
  private async relabel(conversation: Conversation, contactId: string): Promise<void> {
    await this.repointAddresses(conversation, conversation.id, contactId);
    if (conversation.partyId !== contactId || conversation.partyKind !== 'contact') {
      await this.conversations.update(
        conversation,
        { partyKind: 'contact', partyId: contactId },
        { actorId: CONTACT_EVENTS_ACTOR },
      );
    }
  }

  /** Both contacts had a thread: the survivor's takes the addresses, the duplicate's is re-labelled and archived. */
  private async absorb(duplicate: Conversation, survivor: Conversation, contactId: string): Promise<void> {
    const phones = uniq([...survivor.addresses.phones, ...duplicate.addresses.phones]);
    const emails = uniq([...survivor.addresses.emails, ...duplicate.addresses.emails]);
    let current = survivor;
    if (!sameList(phones, survivor.addresses.phones) || !sameList(emails, survivor.addresses.emails)) {
      current = await this.conversations.update(survivor, { addresses: { phones, emails } }, { actorId: CONTACT_EVENTS_ACTOR });
    }
    await this.repointAddresses(duplicate, current.id, contactId);

    const patch: Parameters<ConversationsRepository['update']>[1] = {};
    if (duplicate.partyId !== contactId || duplicate.partyKind !== 'contact') {
      patch.partyKind = 'contact';
      patch.partyId = contactId;
    }
    if (duplicate.state !== 'archived') patch.state = 'archived';
    if (Object.keys(patch).length) {
      await this.conversations.update(duplicate, patch, { actorId: CONTACT_EVENTS_ACTOR });
    }
  }

  /** Every `ADDR#` row of `source`'s addresses that still points at it → `conversationId` / `contactId`. */
  private async repointAddresses(source: Conversation, conversationId: string, contactId: string): Promise<void> {
    const at = new Date().toISOString();
    for (const address of [...source.addresses.phones, ...source.addresses.emails]) {
      const pointer = await this.conversations.getByAddress(address);
      if (pointer && pointer.conversationId !== source.id) continue; // owned by another thread: leave it
      if (pointer && pointer.conversationId === conversationId && pointer.partyId === contactId && pointer.partyKind === 'contact') {
        continue; // already there
      }
      await this.conversations.putAddressPointer({
        address,
        conversationId,
        partyKind: 'contact',
        partyId: contactId,
        source: pointer?.source ?? 'crm',
        updatedAt: at,
      });
    }
  }

  // ----------------------------------------------------- contact.updated

  async onContactUpdated(payload: unknown): Promise<void> {
    if (!isContactUpdatedPayload(payload)) {
      this.logger.warn(`Dropping malformed contact.updated payload: ${JSON.stringify(payload)}`);
      return;
    }
    await this.syncAddresses(payload);
  }

  async syncAddresses({ contactId }: ContactUpdatedPayload): Promise<void> {
    const conversation = await this.conversations.getByParty('contact', contactId);
    if (!conversation) return; // no thread yet: the first message copies the addresses from CRM

    const contact = await this.crm.getContact(contactId);
    if (!contact) {
      // Deleted, or CRM did not answer — nothing to reconcile against; the next event tries again.
      this.logger.warn(`contact.updated ${contactId}: contact not readable, addresses left as they are`);
      return;
    }

    const phones = uniq(contact.phones.map(tryNormalizePhone).filter((p): p is string => !!p));
    const emails = uniq(contact.emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
    const current = conversation.addresses;
    const added = [
      ...phones.filter((p) => !current.phones.includes(p)),
      ...emails.filter((e) => !current.emails.includes(e)),
    ];
    const removed = [
      ...current.phones.filter((p) => !phones.includes(p)),
      ...current.emails.filter((e) => !emails.includes(e)),
    ];
    if (!added.length && !removed.length && sameList(phones, current.phones) && sameList(emails, current.emails)) return;

    const at = new Date().toISOString();
    for (const address of added) {
      const existing = await this.conversations.getByAddress(address);
      if (existing && existing.conversationId !== conversation.id && existing.partyKind !== 'none') {
        // CRM is the owner of record for a number; a stale pointer of another party's thread gives way.
        this.logger.warn(`ADDR#${address} moved from conversation ${existing.conversationId} to ${conversation.id} (contact ${contactId})`);
      }
      const pointer: ConversationAddressPointer = {
        address,
        conversationId: conversation.id,
        partyKind: 'contact',
        partyId: contactId,
        source: 'crm',
        updatedAt: at,
      };
      await this.conversations.putAddressPointer(pointer);
    }
    for (const address of removed) {
      const existing = await this.conversations.getByAddress(address);
      if (existing?.conversationId === conversation.id) {
        await this.conversations.removeAddressPointer(address);
      }
    }

    await this.conversations.update(conversation, { addresses: { phones, emails } }, { actorId: CONTACT_EVENTS_ACTOR });
    this.logger.log(
      `contact.updated ${contactId}: +${added.length} / -${removed.length} address pointer(s) on conversation ${conversation.id}`,
    );
  }
}
