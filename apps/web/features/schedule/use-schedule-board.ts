"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { CalendarEvent, Contact, Deal, JobType, Role, TechnicianProfile } from "@bitcrm/types";
import { settled } from "@/lib/use-page-ready";
import { queryKeys } from "@/lib/query-keys";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { DEALS_POLL_MS, useDealsWindow, useUserMap, type DirectoryUser } from "@/features/deals/hooks";
import * as dealApi from "@/features/deals/api";
import { useDealsStreamStore } from "@/features/deals/stream-store";
import { useLastWhole } from "@/features/dispatch/use-last-whole";
import { useJobTypes } from "@/features/job-types/hooks";
import { useRoles } from "@/features/roles/hooks";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { useCalendarEvents } from "./hooks";
import { viewRange, type ScheduleView } from "./calendar";

export type { ScheduleView } from "./calendar";

/** Everything the calendar draws, for the days it was read for. */
export interface ScheduleBoard {
  view: ScheduleView;
  /** The day the view was picked from. */
  date: string;
  deals: Deal[];
  /** The open jobs with no visit date — Workiz's "Unscheduled jobs" pane. */
  unscheduled: Deal[];
  events: CalendarEvent[];
  /** The unscheduled jobs' clients (the cards name them; the calendar does not). */
  contacts: Map<string, Contact>;
  profiles: TechnicianProfile[];
  users: Map<string, DirectoryUser>;
  jobTypes: Map<string, string>;
  /** The live job types, A to Z — Filter results' JOB TYPE. */
  activeJobTypes: { id: string; name: string }[];
  /** role id → name, when the viewer may read roles (the Timeline's second line). */
  roles: Map<string, string>;
}

const NO_DEALS: Deal[] = [];
const NO_EVENTS: CalendarEvent[] = [];
const NO_TYPES: JobType[] = [];
const NO_ROLES: Role[] = [];

/** The undated open jobs, read whole — a few dozen at most. */
function useUnscheduledDeals() {
  const live = useDealsStreamStore((s) => s.connected);
  return useQuery({
    // Under `deals`, so the live stream and a reschedule refresh it with the rest.
    queryKey: queryKeys.deals.window({ unscheduled: true }),
    queryFn: () => dealApi.fetchAllDeals({ unscheduled: true, sort: "schedule", dir: "asc", limit: 100 }),
    refetchInterval: live ? false : DEALS_POLL_MS,
  });
}

/**
 * The schedule, asked for at once and shown whole.
 *
 * The calendar draws the jobs of the days on screen, coloured and worded from
 * their job types and technicians, the technicians' rows (Timeline) with their
 * time off, and the count of unscheduled jobs on the toolbar. Everything goes
 * out as soon as it can: the jobs, the unscheduled ones, the roster, the
 * directory, the job types and roles together; the unscheduled jobs' clients
 * once those are in; the calendar events once the roster is complete — once,
 * for all of it. `board` is undefined until all of it has answered (a failure
 * counts), and afterwards it is the last complete one: another day or another
 * view turns the calendar over once that one is complete too, instead of
 * emptying it and filling it again.
 */
export function useScheduleBoard({ view, date }: { view: ScheduleView; date: string }, canView: boolean) {
  const { isLoading: permsLoading, can } = usePermissions();
  const { from, to } = viewRange(view, date);

  const dealsQuery = useDealsWindow({ from, to }, { poll: true });
  const unscheduledQuery = useUnscheduledDeals();
  const roster = useAllTechnicians(canView);
  const users = useUserMap();
  const jobTypesQuery = useJobTypes();
  const rolesQuery = useRoles(!permsLoading && can("roles", "view"));
  const deals = dealsQuery.data ?? NO_DEALS;
  const unscheduled = unscheduledQuery.data ?? NO_DEALS;
  const contactIds = useMemo(() => unscheduled.map((d) => d.contactId), [unscheduled]);
  const contacts = useContactsByIds(contactIds);

  // Events for the whole roster, so the filters never ask again — and only
  // once the roster is whole, not once per page of it.
  const allTechIds = useMemo(() => roster.profiles.map((p) => p.userId), [roster.profiles]);
  const events = useCalendarEvents(allTechIds, from, to, canView && !roster.isLoading);

  const whole =
    !permsLoading &&
    settled(dealsQuery) &&
    settled(unscheduledQuery) &&
    !roster.isLoading &&
    !users.isLoading &&
    settled(jobTypesQuery) &&
    settled(rolesQuery) &&
    !contacts.isLoading &&
    settled(events);

  const jobTypeList = jobTypesQuery.data ?? NO_TYPES;
  const jobTypes = useMemo(() => new Map(jobTypeList.map((t) => [t.id, t.name])), [jobTypeList]);
  const activeJobTypes = useMemo(
    () =>
      jobTypeList
        .filter((t) => t.active !== false)
        .map((t) => ({ id: t.id, name: t.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [jobTypeList],
  );
  const roleList = rolesQuery.data ?? NO_ROLES;
  const roles = useMemo(() => new Map(roleList.map((r) => [r.id, r.name])), [roleList]);

  const current = useMemo<ScheduleBoard>(
    () => ({
      view,
      date,
      deals,
      unscheduled,
      events: events.data ?? NO_EVENTS,
      contacts: contacts.map,
      profiles: roster.profiles,
      users: users.map,
      jobTypes,
      activeJobTypes,
      roles,
    }),
    [view, date, deals, unscheduled, events.data, contacts.map, roster.profiles, users.map, jobTypes, activeJobTypes, roles],
  );

  return { board: useLastWhole(current, whole) };
}
