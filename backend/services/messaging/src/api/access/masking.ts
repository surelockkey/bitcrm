import { type Conversation, type Message } from '@bitcrm/types';

/**
 * What a viewer without `contacts.view_numbers` sees: everything except the
 * party's digits (design §7.5, same grant and same rule as the call log).
 *
 * Only phone numbers are withheld — the conversation still says who it is
 * with (party id, name from CRM), the feed still shows every message, and
 * emails stay: the grant is about client phone numbers specifically. The
 * business's own number is not a client number and is never masked.
 *
 * Always copies: the SSE path fans one event object out to every subscriber,
 * so masking in place would blank the numbers for an allowed viewer sharing
 * the object (see telephony `call-masking.ts`).
 */
export interface MaskedConversationFields {
  /** Set when the conversation had phone addresses and they were withheld. */
  phonesMasked?: true;
}
export type MaybeMaskedConversation = Conversation & MaskedConversationFields;

export interface MaskedMessageFields {
  fromMasked?: true;
  toMasked?: true;
  contactAddressMasked?: true;
}
export type MaybeMaskedMessage = Message & MaskedMessageFields;

/** E.164 or at least a bare run of digits — never an email. */
export const looksLikePhone = (value: string | undefined): value is string =>
  !!value && /^\+?\d{5,}$/.test(value);

export function maskConversation(c: Conversation, allowed: boolean): MaybeMaskedConversation;
export function maskConversation(
  c: Conversation | null | undefined,
  allowed: boolean,
): MaybeMaskedConversation | null | undefined;
export function maskConversation(
  c: Conversation | null | undefined,
  allowed: boolean,
): MaybeMaskedConversation | null | undefined {
  if (!c || allowed) return c;
  const phones = c.addresses?.phones ?? [];
  const masked: MaybeMaskedConversation = {
    ...c,
    addresses: { phones: [], emails: c.addresses?.emails ?? [] },
  };
  if (phones.length) masked.phonesMasked = true;
  return masked;
}

export function maskConversations(list: Conversation[], allowed: boolean): MaybeMaskedConversation[] {
  return allowed ? list : list.map((c) => maskConversation(c, false));
}

export function maskMessage(m: Message, allowed: boolean): MaybeMaskedMessage;
export function maskMessage(m: Message | null | undefined, allowed: boolean): MaybeMaskedMessage | null | undefined;
export function maskMessage(m: Message | null | undefined, allowed: boolean): MaybeMaskedMessage | null | undefined {
  if (!m || allowed) return m;
  const business = m.businessNumber;
  const isClientPhone = (v: string | undefined) => looksLikePhone(v) && v !== business;

  const masked: MaybeMaskedMessage = { ...m };
  if (isClientPhone(m.from)) {
    masked.from = undefined;
    masked.fromMasked = true;
  }
  if (isClientPhone(m.to)) {
    masked.to = undefined;
    masked.toMasked = true;
  }
  if (looksLikePhone(m.contactAddress)) {
    masked.contactAddress = undefined;
    masked.contactAddressMasked = true;
  }
  // Raw Workiz json can carry `contact_phone`; a masked viewer gets none of it.
  if (m.workizMeta) masked.workizMeta = undefined;
  return masked;
}

export function maskMessages(list: Message[], allowed: boolean): MaybeMaskedMessage[] {
  return allowed ? list : list.map((m) => maskMessage(m, false));
}
