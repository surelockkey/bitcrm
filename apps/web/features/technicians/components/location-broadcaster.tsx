"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { useLocationBroadcast } from "@/features/technicians/use-location-broadcast";

/**
 * Streams the signed-in technician's live location to the dispatch map while
 * they're online. Renders nothing.
 *
 * On by default for every technician — per the field spec, GPS is enabled for
 * technicians and isn't theirs to switch off (stories/4.03). It's browser
 * geolocation, so it only runs while the tab is open and the technician has
 * granted the permission; a native app would be needed to track in the
 * background. Mounted once in the app shell, so it runs on every page.
 */
export function LocationBroadcaster() {
  const { me, isTechnician } = usePermissions();
  useLocationBroadcast(me?.id, isTechnician && Boolean(me?.id));
  return null;
}
