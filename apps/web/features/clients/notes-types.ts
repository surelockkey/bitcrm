import type { ContactNote, PaginatedResponse } from "@bitcrm/types";

export type { ContactNote };

/**
 * The list envelope of `GET /crm/contacts/:id/notes`: the page, its cursor
 * and, on the first page only, `pagination.notesCount` — the total for the
 * rail badge.
 */
export interface ContactNotesPage extends PaginatedResponse<ContactNote> {
  pagination: PaginatedResponse<ContactNote>["pagination"] & { notesCount?: number };
}
