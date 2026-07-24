"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type { CalendarEventInput } from "./schemas";

/** Calendar events for a set of technicians over [from, to]. */
export function useCalendarEvents(techIds: string[], from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.calendarEvents.range(techIds, from, to),
    queryFn: () => api.listCalendarEvents(techIds, from, to),
    enabled: enabled && techIds.length > 0,
  });
}

function useInvalidateEvents() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.calendarEvents.all() });
}

export function useCreateCalendarEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ techId, body }: { techId: string; body: CalendarEventInput }) =>
      api.createCalendarEvent(techId, body),
    onSuccess: () => {
      invalidate();
      toast.success("Calendar event added");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteCalendarEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ techId, eventId }: { techId: string; eventId: string }) =>
      api.deleteCalendarEvent(techId, eventId),
    onSuccess: () => {
      invalidate();
      toast.success("Calendar event removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
