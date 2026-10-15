"use client";

import { useQuery } from "@tanstack/react-query";
import { http } from "@/lib/api/http";
import { queryKeys } from "@/lib/query-keys";

/**
 * Whether a technician's phone shares its location (owner, 2026-10-15): the
 * phone reports what the OS lets the app do (`PUT
 * /users/technicians/:id/location/state`), and the dispatch map names it —
 * "Location off on the phone" — instead of leaving a pin that simply stopped
 * moving for the dispatcher to puzzle over.
 */

/** What the OS lets the app do with location: Expo's `PermissionStatus`. */
export type LocationPermission = "granted" | "denied" | "undetermined";

/** `GET /users/technicians/location-states`, one row per technician whose phone has said. */
export interface TechnicianLocationState {
  userId: string;
  permission: LocationPermission;
  /** False when the phone gives only an approximate position (iOS "Precise Location" off). */
  precise?: boolean;
  /** Whether the app may read the location in the background ("Always"). */
  background?: boolean;
  /** When the phone's state last changed — "Location off · 25 min ago" counts from it. */
  updatedAt: string;
}

export interface LocationIssue {
  kind: "off" | "approximate";
  /** The roster's line: "Location off". */
  label: string;
  /** The pin card's row: "Location off on the phone". */
  detail: string;
  tone: "danger" | "warning";
}

const OFF: LocationIssue = {
  kind: "off",
  label: "Location off",
  detail: "Location off on the phone",
  tone: "danger",
};

const APPROXIMATE: LocationIssue = {
  kind: "approximate",
  label: "Approximate location only",
  detail: "Approximate location only",
  tone: "warning",
};

/**
 * What the map says about a phone, if anything. Anything but `granted` reads
 * no location at all (`undetermined` included — never asked, or never
 * answered); `precise: false` is a real but rough position. A phone that has
 * said nothing (an older build) gets no claim either way.
 */
export function locationIssue(state: TechnicianLocationState | undefined): LocationIssue | null {
  if (!state) return null;
  if (state.permission !== "granted") return OFF;
  if (state.precise === false) return APPROXIMATE;
  return null;
}

export function statesById(states: TechnicianLocationState[]): Map<string, TechnicianLocationState> {
  return new Map(states.map((s) => [s.userId, s] as const));
}

/**
 * The team's people whose phone shares no location, in the team's order —
 * the map header's "N without location". Approximate still shares one; a
 * phone of someone not on the team (an office login) is not counted.
 */
export function withoutLocation(
  userIds: string[],
  states: Map<string, TechnicianLocationState>,
): Set<string> {
  return new Set(userIds.filter((id) => locationIssue(states.get(id))?.kind === "off"));
}

/** Every technician's phone state, for the dispatch map. */
export function listLocationStates(): Promise<TechnicianLocationState[]> {
  return http.get<TechnicianLocationState[]>("/users/technicians/location-states");
}

/**
 * Polled beside the live locations, at the same pace: a phone switched off
 * shows on the map within the same half-minute its pin stops moving.
 */
export function useTechnicianLocationStates(enabled = true) {
  return useQuery({
    queryKey: queryKeys.technicians.locationStates(),
    queryFn: listLocationStates,
    enabled,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
