/**
 * A note on the CLIENT (Workiz's Notes panel on the client card), as opposed
 * to a job note, which is a timeline entry on the deal. Its own entity in CRM:
 * `CONTACT#<contactId> / NOTE#<createdAt>#<id>` in BitCRM_Contacts.
 *
 * `Contact.notes` (the free-text string on the contact itself) is untouched by
 * these; the web decides how to show the two side by side.
 */
export interface ContactNote {
  id: string;
  contactId: string;
  /** 1–`CONTACT_NOTE_MAX_LENGTH` characters, trimmed. */
  note: string;
  /** Who wrote it — the caller's user id and, as on the job timeline, their email; the web names them from the directory. */
  actorId: string;
  actorName: string;
  /** Pinned notes lead the feed, whatever their date. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  /** Set by the Workiz import; `externalId` is Workiz's own note id. */
  source?: 'workiz';
  externalId?: string;
}

export const CONTACT_NOTE_MAX_LENGTH = 5000;
