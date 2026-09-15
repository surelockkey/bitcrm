/**
 * What crm-service publishes on `contact-events` (EVENTS.md, topic key
 * `crm` in crm's `EventsModule`) and this service consumes through the
 * `contact-events-to-messaging` queue. There is no typed contract in
 * `@bitcrm/types` for these yet, so the shapes are pinned here, next to
 * the guards the handlers run before trusting a polled payload.
 *
 *   contact.merged   { oldContactId, newContactId }   once per absorbed duplicate (`ContactsService.merge`)
 *   contact.updated  { contactId }                    any edit — the changed fields are NOT in the payload,
 *                                                     the handler re-reads the contact from CRM
 */
export const CONTACT_MERGED_EVENT = 'contact.merged';
export const CONTACT_UPDATED_EVENT = 'contact.updated';

export interface ContactMergedPayload {
  oldContactId: string;
  newContactId: string;
}

export interface ContactUpdatedPayload {
  contactId: string;
}

const nonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export const isContactMergedPayload = (p: unknown): p is ContactMergedPayload =>
  !!p &&
  typeof p === 'object' &&
  nonEmptyString((p as ContactMergedPayload).oldContactId) &&
  nonEmptyString((p as ContactMergedPayload).newContactId);

export const isContactUpdatedPayload = (p: unknown): p is ContactUpdatedPayload =>
  !!p && typeof p === 'object' && nonEmptyString((p as ContactUpdatedPayload).contactId);
