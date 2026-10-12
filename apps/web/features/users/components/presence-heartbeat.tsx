"use client";

import { usePermissions } from "@/features/auth/use-permissions";
import { usePresenceHeartbeat } from "../use-presence-heartbeat";

/** Keeps the signed-in user "Online" on Admin → Users while a tab is in view. Renders nothing. */
export function PresenceHeartbeat() {
  const { me } = usePermissions();
  usePresenceHeartbeat(Boolean(me?.id));
  return null;
}
