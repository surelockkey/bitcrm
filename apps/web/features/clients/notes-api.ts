import { apiFetchPaginated, http } from "@/lib/api/http";
import type { ContactNote, ContactNotesPage } from "./notes-types";

const PAGE = 30;

/** `GET /crm/contacts/:id/notes` — pinned first, then newest, a page at a time. */
export function listContactNotes(contactId: string, cursor?: string, limit = PAGE): Promise<ContactNotesPage> {
  const q = new URLSearchParams({ limit: String(limit) });
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<ContactNote, ContactNotesPage>(`/crm/contacts/${contactId}/notes?${q}`);
}

export const createContactNote = (contactId: string, note: string): Promise<ContactNote> =>
  http.post<ContactNote>(`/crm/contacts/${contactId}/notes`, { note });

export const updateContactNote = (
  contactId: string,
  noteId: string,
  body: { note?: string; pinned?: boolean },
): Promise<ContactNote> => http.patch<ContactNote>(`/crm/contacts/${contactId}/notes/${noteId}`, body);

export const deleteContactNote = (contactId: string, noteId: string): Promise<{ deleted: true }> =>
  http.delete<{ deleted: true }>(`/crm/contacts/${contactId}/notes/${noteId}`);
