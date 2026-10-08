import type { SendMessageBody, StartConversationBody, TextLookupPartyKind } from "./api";

export interface FirstTextTarget {
  partyKind: TextLookupPartyKind;
  partyId: string;
  /** The job the text is about; recorded on the message. */
  dealId?: string;
  /** The number to text, when the caller chose one (the job's own, on the job page). */
  address?: string;
  /** `address` is one of the contact's own numbers. */
  addressOnParty?: boolean;
}

/**
 * The body of the text that opens a party's conversation (`POST /messages`).
 * A contact is addressed by id — on the number given when it is theirs; a
 * number the client record does not carry (a job's own phone) can only be
 * texted as a number, since the server refuses a contact + foreign number.
 */
export function firstTextBody(body: SendMessageBody, t: FirstTextTarget): StartConversationBody {
  const base = t.dealId ? { ...body, dealId: t.dealId } : { ...body };
  if (t.partyKind === "contact" && (!t.address || t.addressOnParty)) {
    return t.address ? { ...base, contactId: t.partyId, toAddress: t.address } : { ...base, contactId: t.partyId };
  }
  return { ...base, phone: t.address as string };
}
