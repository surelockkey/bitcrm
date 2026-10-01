"use client";

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./notes-api";

/** The client's notes, a page at a time; the rail's badge reads the first page's count. */
export function useContactNotes(contactId: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.contacts.notes(contactId),
    queryFn: ({ pageParam }) => api.listContactNotes(contactId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled: enabled && !!contactId,
  });
}

function useInvalidateNotes(contactId: string) {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.contacts.notes(contactId) });
}

export function useAddContactNote(contactId: string) {
  const invalidate = useInvalidateNotes(contactId);
  return useMutation({
    mutationFn: (note: string) => api.createContactNote(contactId, note),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateContactNote(contactId: string) {
  const invalidate = useInvalidateNotes(contactId);
  return useMutation({
    mutationFn: ({ noteId, ...body }: { noteId: string; note?: string; pinned?: boolean }) =>
      api.updateContactNote(contactId, noteId, body),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteContactNote(contactId: string) {
  const invalidate = useInvalidateNotes(contactId);
  return useMutation({
    mutationFn: (noteId: string) => api.deleteContactNote(contactId, noteId),
    onSuccess: () => {
      invalidate();
      toast.success("Note deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
