"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Deal,
  DispatchMapClient,
  ServiceArea,
  TechnicianLocation,
  TechnicianName,
  TechnicianProfile,
} from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { settled } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { DEALS_POLL_MS, useUserMap, type DirectoryUser } from "@/features/deals/hooks";
import { useDealsStreamStore } from "@/features/deals/stream-store";
import type { DealsWindow } from "@/features/deals/window";
import { useJobTypes } from "@/features/job-types/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { useAllTechnicians, useTechnicianLocations } from "@/features/technicians/hooks";
import { mergeLivePositions, technicianPositions, todayISO, type TechnicianPosition } from "./lib";
import {
  statesById,
  useTechnicianLocationStates,
  type TechnicianLocationState,
} from "./location-state";
import { readDispatchJobs, type DispatchJobs, type DispatchMapQuery } from "./map-api";
import { useLastWhole } from "./use-last-whole";
import { useReverseGeocode } from "./use-reverse-geocode";

/** Everything the board draws, answered together. */
export interface DispatchBoard {
  /** The days and statuses these jobs were read for. */
  window: DealsWindow;
  deals: Deal[];
  /**
   * How many open jobs there are whatever the date — the sidebar's "out of N
   * open jobs". `deals.length` when the board read them all (Any date).
   */
  openTotal: number;
  /**
   * Today's open jobs (Connecticut's day) — where the team is and what is
   * left of its day. `deals`' own when the window holds today; read beside
   * them when it does not and the team is drawn.
   */
  todayDeals: Deal[];
  /**
   * Done / Canceled jobs read for `closedWindow` (ours: the Filters' Done /
   * Canceled ticks) — never among `deals`, which stays the open set.
   */
  closedDeals: Deal[];
  /** What `closedDeals` were read for; null when nothing closed was asked. */
  closedWindow: DealsWindow | null;
  /** The jobs could not be read. */
  failed: boolean;
  /** When the jobs on the board were read — what "Updated N ago" counts from. */
  updatedAt: number;
  /** The jobs' clients: names, numbers and emails as crm shows them to the viewer. */
  contacts: Map<string, DispatchMapClient>;
  users: Map<string, DirectoryUser>;
  profiles: TechnicianProfile[];
  /** Where each technician is: a live fix over the derived home / last-job spot. */
  technicians: TechnicianPosition[];
  /** When the live fixes were read — what "Online · 3 min ago" counts from. */
  fixesAt: number;
  /** userId → what their phone says about location: "Location off on the phone". */
  locationStates: Map<string, TechnicianLocationState>;
  /** userId → the street a technician is on. */
  addresses: Map<string, string>;
  areas: ServiceArea[];
}

/** What is drawn right now — the board waits only for what is on screen. */
export interface BoardShows {
  /** The team is drawn: the Techs tab, or "Show techs" on the Jobs tab. */
  techs: boolean;
  /** The team's streets are drawn: the Techs tab's rows. */
  streets: boolean;
}

const NO_DEALS: Deal[] = [];
const NO_FIXES: TechnicianLocation[] = [];
const NO_STATES: TechnicianLocationState[] = [];
const NO_AREAS: ServiceArea[] = [];
const NO_TECH_NAMES: TechnicianName[] = [];
/** The key a closed read sits under while none is asked — never fetched. */
const NO_CLOSED: DispatchMapQuery = { statuses: [] };

/** The map's question for a window: its statuses and, for a closed read, its days. */
function mapQuery(w: DealsWindow): DispatchMapQuery {
  return {
    ...(w.statuses?.length && { statuses: w.statuses }),
    ...(w.from && { from: w.from, to: w.to ?? w.from }),
  };
}

/**
 * One read of the map — `GET /deals/map`, the jobs with their clients' and
 * techs' names — polled while the live stream is down, like every board.
 */
function useDispatchJobs(query: DispatchMapQuery, { enabled = true }: { enabled?: boolean } = {}) {
  const live = useDealsStreamStore((s) => s.connected);
  return useQuery<DispatchJobs>({
    queryKey: queryKeys.deals.map(query),
    queryFn: () => readDispatchJobs(query),
    refetchInterval: live ? false : DEALS_POLL_MS,
    enabled,
  });
}

/**
 * The dispatch board, asked for at once and shown whole.
 *
 * The jobs come in ONE request (`GET /deals/map`) with the names of their
 * clients and techs beside them; the catalogs, the team, its live fixes and
 * the service areas go out at the same moment. `board` is undefined until
 * everything ON SCREEN has answered (a failure counts — one broken request
 * never keeps the board off the screen), and from then on it is the last
 * complete board: another day or set of statuses turns the board over once
 * that one is complete too, instead of emptying it while it loads.
 *
 * What is on screen decides what is waited for (`shows`): the Jobs tab draws
 * the jobs, the job types and the areas, and names its techs from the map's
 * own answer — it does not wait for the team's directory, roster, live fixes,
 * phone states or streets unless "Show techs" draws the team; the Techs tab
 * waits for all of them, streets included (`techsReady`).
 */
export function useDispatchBoard(
  window: DealsWindow,
  {
    techs,
    areas: withAreas,
    closed = null,
    shows = { techs: true, streets: true },
  }: { techs: boolean; areas: boolean; closed?: DealsWindow | null; shows?: BoardShows },
) {
  const { isLoading: permsLoading } = usePermissions();
  const openKey = JSON.stringify(mapQuery(window));
  const openQuery = useMemo(() => JSON.parse(openKey) as DispatchMapQuery, [openKey]);
  const query = useDispatchJobs(openQuery);
  const deals = query.data?.deals ?? NO_DEALS;
  const openTotal = query.data?.totalAnyDate ?? deals.length;
  // Where the team is comes from today's jobs: a window without today (an
  // earlier or a later week) reads today's open jobs beside it, for the team only.
  const today = todayISO();
  const holdsToday = !window.from || (window.from <= today && today <= (window.to ?? window.from));
  const todayKey = JSON.stringify({ from: today, to: today } satisfies DispatchMapQuery);
  const todayQueryKey = useMemo(() => JSON.parse(todayKey) as DispatchMapQuery, [todayKey]);
  const todayQuery = useDispatchJobs(todayQueryKey, { enabled: techs && shows.techs && !holdsToday });
  const todayDeals = holdsToday ? deals : (todayQuery.data?.deals ?? NO_DEALS);
  // Closed jobs only when asked, for their days — part of the same whole board.
  const closedKey = JSON.stringify(closed ? mapQuery(closed) : NO_CLOSED);
  const closedQueryKey = useMemo(() => JSON.parse(closedKey) as DispatchMapQuery, [closedKey]);
  const closedQuery = useDispatchJobs(closedQueryKey, { enabled: closed !== null });
  const closedDeals = (closed && closedQuery.data?.deals) || NO_DEALS;

  const contacts = useMemo(() => {
    const m = new Map<string, DispatchMapClient>();
    for (const c of query.data?.clients ?? []) m.set(c.id, c);
    if (closed) for (const c of closedQuery.data?.clients ?? []) m.set(c.id, c);
    return m;
  }, [query.data, closedQuery.data, closed]);

  const directory = useUserMap();
  // The techs on the jobs come named with them; the directory names everyone
  // else (the Techs tab, the Filters' list) and wins where it has the person.
  const carriedNames = query.data?.technicians;
  const closedNames = closed ? closedQuery.data?.technicians : NO_TECH_NAMES;
  const users = useMemo(() => {
    const m = new Map<string, DirectoryUser>();
    for (const t of [...(carriedNames ?? []), ...(closedNames ?? [])]) m.set(t.id, t);
    for (const [id, u] of directory.map) m.set(id, u);
    return m;
  }, [carriedNames, closedNames, directory.map]);
  // A deal-service from before `/deals/map` names no techs: the directory must.
  const jobTechsNamed = carriedNames !== null && carriedNames !== undefined;

  const roster = useAllTechnicians(techs);
  const locations = useTechnicianLocations(techs);
  // Whose phone shares no location — part of the team, read beside the fixes.
  const states = useTechnicianLocationStates(techs);
  // A user-service from before the endpoint answers 404: nothing to say.
  const statesData = states.data ?? NO_STATES;
  const locationStates = useMemo(() => statesById(statesData), [statesData]);
  const areas = useServiceAreas(withAreas);
  // The rows name their job type; the catalog comes with them, not after.
  const jobTypes = useJobTypes();

  // A fix's age is counted from when the fixes were read — the poll that
  // brought them — so the roster says the same thing on every render.
  const fixesAt = locations.dataUpdatedAt;
  const technicians = useMemo(() => {
    const derived = technicianPositions(roster.profiles, todayDeals, today);
    // A real GPS fix beats the inferred home/last-job position when the
    // technician is online.
    return mergeLivePositions(derived, locations.data ?? NO_FIXES, fixesAt);
  }, [roster.profiles, todayDeals, today, locations.data, fixesAt]);
  // Streets are looked up once the spots are final: asking while the jobs are
  // still on their way would geocode a home address the last job of the day
  // then replaces — a wasted lookup out of Google's small per-session allowance.
  // A disabled read (today in the window, or the team not drawn) counts as settled.
  const todaySettled = holdsToday || settled(todayQuery);
  const placed = settled(query) && todaySettled && !roster.isLoading && settled(locations);
  const geo = useReverseGeocode(technicians, techs && placed);

  const teamIn =
    !directory.isLoading && !roster.isLoading && settled(locations) && settled(states) && todaySettled;
  const techsReady = teamIn && !geo.pending;

  const whole =
    !permsLoading &&
    settled(query) &&
    settled(closedQuery) &&
    settled(areas) &&
    settled(jobTypes) &&
    (jobTechsNamed || !directory.isLoading) &&
    (!shows.techs || teamIn) &&
    (!shows.streets || !geo.pending);

  const current = useMemo<DispatchBoard>(
    () => ({
      window,
      deals,
      openTotal,
      todayDeals,
      closedDeals,
      closedWindow: closed,
      failed: query.isError,
      updatedAt: query.dataUpdatedAt,
      contacts,
      users,
      profiles: roster.profiles,
      technicians,
      fixesAt,
      locationStates,
      addresses: geo.addresses,
      areas: areas.data ?? NO_AREAS,
    }),
    [
      window,
      deals,
      openTotal,
      todayDeals,
      closedDeals,
      closed,
      query.isError,
      query.dataUpdatedAt,
      contacts,
      users,
      roster.profiles,
      technicians,
      fixesAt,
      locationStates,
      geo.addresses,
      areas.data,
    ],
  );

  return { board: useLastWhole(current, whole), query, techsReady };
}
