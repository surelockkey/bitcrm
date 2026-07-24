import type { CalendarEvent } from "@bitcrm/types";
import { http } from "@/lib/api/http";
import type { CalendarEventInput } from "./schemas";

const BASE = "/users/technicians";

/** Calendar events for many technicians over an inclusive date range. */
export function listCalendarEvents(
  techIds: string[],
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const q = new URLSearchParams({ from, to, techIds: techIds.join(",") });
  return http.get<CalendarEvent[]>(`${BASE}/calendar-events?${q}`);
}

export function createCalendarEvent(
  techId: string,
  body: CalendarEventInput,
): Promise<CalendarEvent> {
  return http.post<CalendarEvent>(`${BASE}/${techId}/calendar-events`, body);
}

export function updateCalendarEvent(
  techId: string,
  eventId: string,
  body: Partial<CalendarEventInput>,
): Promise<CalendarEvent> {
  return http.put<CalendarEvent>(`${BASE}/${techId}/calendar-events/${eventId}`, body);
}

export function deleteCalendarEvent(techId: string, eventId: string): Promise<null> {
  return http.delete<null>(`${BASE}/${techId}/calendar-events/${eventId}`);
}
