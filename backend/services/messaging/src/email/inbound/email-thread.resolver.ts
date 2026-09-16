import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { type Conversation } from '@bitcrm/types';
import { ConversationsRepository } from '../../conversations/conversations.repository';
import { type ResolvedParty } from '../../inbound/party-resolver';
import { MessagesRepository } from '../../messages/messages.repository';
import { EMAIL_CONFIG, type EmailConfig } from '../email.config';
import { findReplyToken } from '../reply-token';
import { sesMessageIdFromHeader } from '../ses-error.map';
import { EmailDirectory } from './email-directory';

export type EmailThreadRoute = 'token' | 'reply' | 'address' | 'directory' | 'unknown';

export interface EmailThreadInput {
  /** Lowercase sender address. */
  sender: string;
  /** Every address the mail was delivered to: envelope recipients, To, Cc. */
  recipients: string[];
  inReplyTo?: string;
  references?: string[];
}

export interface EmailThreadResolution {
  conversation: Conversation;
  created: boolean;
  /** Which rule placed the mail — for logs and tests. */
  route: EmailThreadRoute;
  party?: ResolvedParty;
}

/**
 * Where an inbound mail belongs (design §5, variant A), in order:
 *
 *   1. token    a recipient is `c-<conversationId>@reply.<domain>` (our Reply-To);
 *   2. reply    `In-Reply-To` / `References` name a `Message-ID` SES stamped on
 *               one of our mails → `PSID#<sesMessageId>` → its conversation;
 *   3. address  `ADDR#<sender>` — the pointer written the last time this
 *               address was routed (or an outbound email went to it);
 *   4. directory the CRM knows the address → that party's conversation,
 *               created when the party has none;
 *   5. unknown  an `unknown` conversation keyed `CONVOF#address#<sender>`,
 *               `needsResolution` when the CRM could not be asked.
 *
 * Whichever rule wins, the sender address is adopted onto the conversation
 * (`addresses.emails` + `ADDR#`) so the next mail from it takes rule 3.
 */
@Injectable()
export class EmailThreadResolver {
  private readonly logger = new Logger(EmailThreadResolver.name);

  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly messages: MessagesRepository,
    private readonly directory: EmailDirectory,
    @Inject(EMAIL_CONFIG) private readonly config: Pick<EmailConfig, 'fromAddress' | 'replyDomain'>,
  ) {}

  async resolve(input: EmailThreadInput, at: string = new Date().toISOString()): Promise<EmailThreadResolution> {
    const byToken = await this.byToken(input.recipients);
    if (byToken) return this.adopt(byToken, input.sender, at, 'token');

    const byReply = await this.byReply([input.inReplyTo, ...(input.references ?? [])]);
    if (byReply) return this.adopt(byReply, input.sender, at, 'reply');

    const pointer = await this.conversations.getByAddress(input.sender);
    if (pointer) {
      const pointed = await this.conversations.get(pointer.conversationId);
      if (pointed) return { conversation: pointed, created: false, route: 'address', party: partyOf(pointed) };
      this.logger.warn(`ADDR#${input.sender} points at missing conversation ${pointer.conversationId}; re-resolving`);
    }

    const looked = await this.directory.lookupContact(input.sender);
    if (looked && looked !== 'unreachable') {
      const party: ResolvedParty = { kind: looked.kind, id: looked.id, name: looked.name };
      const { conversation, created } = await this.conversations.findOrCreate({
        conversation: this.newConversation(input.sender, at, party),
        pointer: { kind: party.kind, id: party.id },
        addresses: [{ address: input.sender, source: 'crm' }],
      });
      if (created) return { conversation, created, route: 'directory', party };
      return { ...(await this.adopt(conversation, input.sender, at, 'directory')), party };
    }

    const degraded = looked === 'unreachable';
    const { conversation, created } = await this.conversations.findOrCreate({
      conversation: this.newConversation(input.sender, at, undefined, degraded),
      pointer: { kind: 'address', id: input.sender },
    });
    if (created) return { conversation, created, route: 'unknown' };
    const flagged = conversation.needsResolution === true;
    const synced =
      flagged === degraded ? conversation : await this.conversations.update(conversation, { needsResolution: degraded ? true : null }, { at });
    return { conversation: synced, created: false, route: 'unknown' };
  }

  // -------------------------------------------------------------- internals

  private async byToken(recipients: string[]): Promise<Conversation | null> {
    const conversationId = findReplyToken(recipients, this.config);
    if (!conversationId) return null;
    const conversation = await this.conversations.get(conversationId);
    if (!conversation) this.logger.warn(`Reply token names a missing conversation ${conversationId}; falling through`);
    return conversation;
  }

  private async byReply(headers: Array<string | undefined>): Promise<Conversation | null> {
    for (const header of headers) {
      const sesId = sesMessageIdFromHeader(header);
      if (!sesId) continue;
      const pointer = await this.messages.getProviderSidPointer(sesId);
      if (!pointer) continue;
      const conversation = await this.conversations.get(pointer.conversationId);
      if (conversation) return conversation;
    }
    return null;
  }

  /** Record the address on the conversation and point `ADDR#` at it (the SMS `adoptAddress`). */
  private async adopt(conversation: Conversation, sender: string, at: string, route: EmailThreadRoute): Promise<EmailThreadResolution> {
    const source = conversation.partyKind === 'none' ? 'manual' : 'crm';
    await this.conversations.putAddressPointer({
      address: sender,
      conversationId: conversation.id,
      partyKind: conversation.partyKind,
      partyId: conversation.partyId,
      source,
      updatedAt: at,
    });
    const emails = conversation.addresses?.emails ?? [];
    const updated = emails.includes(sender)
      ? conversation
      : await this.conversations.update(
          conversation,
          { addresses: { phones: conversation.addresses?.phones ?? [], emails: [...emails, sender] } },
          { at },
        );
    return { conversation: updated, created: false, route, party: partyOf(updated) };
  }

  private newConversation(sender: string, at: string, party?: ResolvedParty, needsResolution = false): Conversation {
    return {
      id: randomUUID(),
      kind: party ? (party.kind === 'user' ? 'team' : 'client') : 'unknown',
      partyKind: party?.kind ?? 'none',
      partyId: party?.id,
      addresses: { phones: [], emails: [sender] },
      state: 'open',
      unread: false,
      unreadCount: 0,
      flagged: false,
      needsResolution: needsResolution || undefined,
      createdAt: at,
      updatedAt: at,
    };
  }
}

const partyOf = (c: Conversation): ResolvedParty | undefined =>
  c.partyId && (c.partyKind === 'contact' || c.partyKind === 'company' || c.partyKind === 'user')
    ? { kind: c.partyKind, id: c.partyId }
    : undefined;
