import { Injectable } from '@nestjs/common';
import { type ConversationPartyKind } from '@bitcrm/types';
import { ConversationsRepository } from '../conversations/conversations.repository';
import { PhoneDirectory } from './phone-directory';

/** Who a phone number belongs to, as far as the inbound path needs to know. */
export interface ResolvedParty {
  kind: Exclude<ConversationPartyKind, 'group' | 'none'>;
  id: string;
  name?: string;
}

export interface PartyResolution {
  party?: ResolvedParty;
  /** Set when `ADDR#<phone>` already pointed at a conversation (no directory call was made). */
  conversationId?: string;
  /**
   * A directory (user-service or CRM) could not be asked, so a "no party"
   * answer is provisional: the conversation gets `needsResolution` (§4.3).
   */
  degraded: boolean;
}

/**
 * The inbound routing order of design §4.3 step 4, and the precedence
 * telephony's `party-resolver.ts` uses for a bare number:
 *
 *   1. `ADDR#<From>` — the pointer written the last time this number was routed;
 *   2. one of our own people, by their personal number (user-service);
 *   3. a CRM contact, then a company main line (crm-service);
 *   4. nobody → the caller opens an `unknown` conversation.
 *
 * Only step 1 touches DynamoDB; steps 2–3 are one internal HTTP call each and
 * happen only on a pointer miss, which keeps the webhook well under Twilio's
 * timeout on the common path.
 */
@Injectable()
export class PartyResolver {
  constructor(
    private readonly conversations: ConversationsRepository,
    private readonly directory: PhoneDirectory,
  ) {}

  async resolve(phone: string): Promise<PartyResolution> {
    const pointer = await this.conversations.getByAddress(phone);
    if (pointer) {
      const party =
        pointer.partyId && isPartyKind(pointer.partyKind)
          ? { kind: pointer.partyKind, id: pointer.partyId }
          : undefined;
      return { party, conversationId: pointer.conversationId, degraded: false };
    }
    return this.lookup(phone);
  }

  /** Steps 2–4 only — for a background re-resolution that must skip the pointer. */
  async lookup(phone: string): Promise<PartyResolution> {
    let degraded = false;

    const user = await this.directory.lookupUser(phone);
    if (user === 'unreachable') degraded = true;
    else if (user) return { party: { kind: 'user', id: user.id, name: user.name }, degraded: false };

    const contact = await this.directory.lookupContact(phone);
    if (contact === 'unreachable') degraded = true;
    else if (contact) {
      return { party: { kind: contact.kind, id: contact.id, name: contact.name }, degraded: false };
    }

    return { degraded };
  }
}

const isPartyKind = (kind: ConversationPartyKind): kind is ResolvedParty['kind'] =>
  kind === 'contact' || kind === 'company' || kind === 'user';
