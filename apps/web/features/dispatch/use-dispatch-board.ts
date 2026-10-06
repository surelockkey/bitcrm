"use client";

import { useMemo } from "react";
import type { Contact, Deal, ServiceArea, TechnicianLocation, TechnicianProfile } from "@bitcrm/types";
import { settled } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { useDealsWindow, useUserMap, type DirectoryUser } from "@/features/deals/hooks";
import type { DealsWindow } from "@/features/deals/window";
import { useJobTypes } from "@/features/job-types/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { useAllTechnicians, useTechnicianLocations } from "@/features/technicians/hooks";
import { mergeLivePositions, technicianPositions, todayISO, type TechnicianPosition } from "./lib";
import { useLastWhole } from "./use-last-whole";
import { useReverseGeocode } from "./use-reverse-geocode";

/** Everything the board draws, answered together. */
export interface DispatchBoard {
  /** The days and statuses these jobs were read for. */
  window: DealsWindow;
  deals: Deal[];
  /** The jobs could not be read. */
  failed: boolean;
  /** When the jobs on the board were read — what "Updated N ago" counts from. */
  updatedAt: number;
  contacts: Map<string, Contact>;
  users: Map<string, DirectoryUser>;
  profiles: TechnicianProfile[];
  /** Where each technician is: a live fix over the derived home / last-job spot. */
  technicians: TechnicianPosition[];
  /** When the live fixes were read — what "Online · 3 min ago" counts from. */
  fixesAt: number;
  /** userId → the street a technician is on. */
  addresses: Map<string, string>;
  areas: ServiceArea[];
}

const NO_DEALS: Deal[] = [];
const NO_FIXES: TechnicianLocation[] = [];
const NO_AREAS: ServiceArea[] = [];

/**
 * The dispatch board, asked for at once and shown whole.
 *
 * The board draws jobs, their clients' names, the job types, the technicians
 * with their names, live status and street, and the service areas. These used
 * to arrive one after another and be drawn as each came — a client column of
 * "Unknown client", a roster of "Technician" that re-sorted itself when the
 * GPS fixes landed, street lines pushing the rows down for a second more.
 *
 * Every question goes out the moment it can: what needs nothing but the
 * permissions with the jobs, the clients the moment the jobs are in, the
 * streets the moment the technicians can be placed. `board` is undefined
 * until all of it has answered (a failure counts — one broken request never
 * keeps the board off the screen), and from then on it is the last complete
 * board: another day or set of statuses turns the board over once that one is
 * complete too, instead of emptying it while it loads. Live fixes and polls
 * update it the same way.
 */
export function useDispatchBoard(
  window: DealsWindow,
  { techs, areas: withAreas }: { techs: boolean; areas: boolean },
) {
  const { isLoading: permsLoading } = usePermissions();
  const query = useDealsWindow(window, { poll: true });
  const deals = query.data ?? NO_DEALS;
  const contactIds = useMemo(() => deals.map((d) => d.contactId), [deals]);
  const contacts = useContactsByIds(contactIds);
  const users = useUserMap();
  const roster = useAllTechnicians(techs);
  const locations = useTechnicianLocations(techs);
  const areas = useServiceAreas(withAreas);
  // The rows name their job type; the catalog comes with them, not after.
  const jobTypes = useJobTypes();

  // A fix's age is counted from when the fixes were read — the poll that
  // brought them — so the roster says the same thing on every render.
  const fixesAt = locations.dataUpdatedAt;
  const technicians = useMemo(() => {
    const derived = technicianPositions(roster.profiles, deals, todayISO());
    // A real GPS fix beats the inferred home/last-job position when the
    // technician is online.
    return mergeLivePositions(derived, locations.data ?? NO_FIXES, fixesAt);
  }, [roster.profiles, deals, locations.data, fixesAt]);
  // Streets are looked up once the spots are final: asking while the jobs are
  // still draining would geocode a home address the last job of the day then
  // replaces — a wasted lookup out of Google's small per-session allowance.
  const placed = settled(query) && !roster.isLoading && settled(locations);
  const geo = useReverseGeocode(technicians, techs && placed);

  const whole =
    !permsLoading &&
    settled(query) &&
    !contacts.isLoading &&
    !users.isLoading &&
    !roster.isLoading &&
    settled(locations) &&
    settled(areas) &&
    settled(jobTypes) &&
    !geo.pending;

  const current = useMemo<DispatchBoard>(
    () => ({
      window,
      deals,
      failed: query.isError,
      updatedAt: query.dataUpdatedAt,
      contacts: contacts.map,
      users: users.map,
      profiles: roster.profiles,
      technicians,
      fixesAt,
      addresses: geo.addresses,
      areas: areas.data ?? NO_AREAS,
    }),
    [
      window,
      deals,
      query.isError,
      query.dataUpdatedAt,
      contacts.map,
      users.map,
      roster.profiles,
      technicians,
      fixesAt,
      geo.addresses,
      areas.data,
    ],
  );

  return { board: useLastWhole(current, whole), query };
}
