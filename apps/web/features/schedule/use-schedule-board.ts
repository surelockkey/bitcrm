"use client";

import { useMemo } from "react";
import type { CalendarEvent, Contact, Deal, TechnicianProfile } from "@bitcrm/types";
import { settled } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { useDealsWindow, useUserMap, type DirectoryUser } from "@/features/deals/hooks";
import { useLastWhole } from "@/features/dispatch/use-last-whole";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { useCalendarEvents } from "./hooks";
import { weekDays } from "./lib";

export type ScheduleView = "day" | "week";

/** Everything the grid draws, for the day or week it was read for. */
export interface ScheduleBoard {
  view: ScheduleView;
  /** The day shown, or the day the shown week was picked from. */
  date: string;
  deals: Deal[];
  events: CalendarEvent[];
  contacts: Map<string, Contact>;
  profiles: TechnicianProfile[];
  users: Map<string, DirectoryUser>;
}

const NO_DEALS: Deal[] = [];
const NO_EVENTS: CalendarEvent[] = [];

/**
 * The schedule grid, asked for at once and shown whole.
 *
 * The grid draws the roster's columns under their names, the day's jobs
 * under their clients' names, and each technician's time off. They used to
 * be drawn as each answer came: columns headed "Technician" (and some dropped
 * a moment later, once the directory said they are off the field team), job
 * blocks reading "Client", time off last — and the calendar was asked for
 * again for every page of the roster.
 *
 * Everything goes out as soon as it can: the jobs, the roster and the
 * directory together, the clients once the jobs are in, the calendar once the
 * roster is complete — once, for all of it. `board` is undefined until all of
 * it has answered (a failure counts), and afterwards it is the last complete
 * grid: another day or the week view turns the grid over once that one is
 * complete too, instead of emptying it and filling it again.
 */
export function useScheduleBoard({ view, date }: { view: ScheduleView; date: string }, canView: boolean) {
  const { isLoading: permsLoading } = usePermissions();
  const week = useMemo(() => weekDays(date), [date]);
  const [from, to] = view === "day" ? [date, date] : [week[0], week[6]];

  // The board holds one day or one week — never the whole table.
  const dealsQuery = useDealsWindow({ from, to }, { poll: true });
  const roster = useAllTechnicians(canView);
  const users = useUserMap();
  const deals = dealsQuery.data ?? NO_DEALS;
  const contactIds = useMemo(() => deals.map((d) => d.contactId), [deals]);
  const contacts = useContactsByIds(contactIds);

  // Events for the whole roster, so toggling the technician filters never
  // asks again — and only once the roster is whole, not once per page of it.
  const allTechIds = useMemo(() => roster.profiles.map((p) => p.userId), [roster.profiles]);
  const events = useCalendarEvents(allTechIds, from, to, canView && !roster.isLoading);

  const whole =
    !permsLoading &&
    settled(dealsQuery) &&
    !roster.isLoading &&
    !users.isLoading &&
    !contacts.isLoading &&
    settled(events);

  const current = useMemo<ScheduleBoard>(
    () => ({
      view,
      date,
      deals,
      events: events.data ?? NO_EVENTS,
      contacts: contacts.map,
      profiles: roster.profiles,
      users: users.map,
    }),
    [view, date, deals, events.data, contacts.map, roster.profiles, users.map],
  );

  return { board: useLastWhole(current, whole) };
}
