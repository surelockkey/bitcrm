/**
 * Canonical contract for the events on the `contact-events` SNS topic
 * (EVENTS.md). Publisher: crm-service (`ContactsService.publishEvent`, topic
 * name `crm`). Consumers: deal-service and messaging-service (`contact.merged`,
 * `contact.updated`), search-service (index). Only the payloads a consumer
 * needs the shape of are typed here; the rest stay documented in EVENTS.md.
 */
export const CONTACT_EVENT_TOPIC = 'contact-events' as const;

export const ContactEventType = {
  CONTACT_CREATED: 'contact.created',
  CONTACT_UPDATED: 'contact.updated',
  /** Once per absorbed duplicate: `{ oldContactId, newContactId }`. */
  CONTACT_MERGED: 'contact.merged',
  /** A note was added to a client (the client card's Notes panel) — for a future history consumer. */
  CONTACT_NOTE_ADDED: 'contact.note_added',
} as const;

export type ContactEventType = (typeof ContactEventType)[keyof typeof ContactEventType];

// --- Payloads ---

export interface ContactNoteAddedEvent {
  contactId: string;
  noteId: string;
  actorId: string;
  actorName: string;
  createdAt: string;
}
