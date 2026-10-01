import type { PaginatedResponse } from "@bitcrm/types";

/**
 * One note on a client (CRM `/crm/contacts/:id/notes`). Lives here until
 * `@bitcrm/types` carries it — the backend branch is still landing.
 */
export interface ContactNote {
  id: string;
  contactId: string;
  note: string;
  actorId: string;
  actorName: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

/** The list envelope: the page, its cursor and, when the CRM counts, the total. */
export interface ContactNotesPage extends PaginatedResponse<ContactNote> {
  notesCount?: number;
}
