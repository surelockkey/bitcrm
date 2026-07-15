"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { useProfile } from "@/features/technicians/hooks";
import { useLocationBroadcast } from "@/features/technicians/use-location-broadcast";

/**
 * Streams the signed-in technician's live location to the dispatch map while
 * they're online. Renders nothing.
 *
 * Only for technicians, and only when a manager has enabled GPS on their profile
 * (`gpsTrackingEnabled`) — the same toggle shown in the profile. Everyone else,
 * and technicians with it off, broadcast nothing. Mounted once in the app shell,
 * so it runs on every page for as long as the technician has the app open.
 */
export function LocationBroadcaster() {
  const { me, isTechnician } = usePermissions();
  const profileQuery = useProfile(me?.id ?? "", isTechnician && Boolean(me?.id));
  const enabled = isTechnician && profileQuery.data?.gpsTrackingEnabled === true;

  useLocationBroadcast(me?.id, Boolean(enabled));
  return null;
}
