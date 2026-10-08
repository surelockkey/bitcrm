"use client";

import { settled } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useMessagingSettings } from "@/features/messaging/hooks";

/**
 * The workspace's own number — the pill beside Workiz's "Workiz Phone"
 * heading ("(203) 403-6303"). Ours is the messaging default sender (Settings
 * → Messaging → Default number), readable with `settings.view`; without it,
 * or unset, there is no pill. `settled` once that is known.
 */
export function useMainNumber(): { number?: string; settled: boolean } {
  const { can, isLoading } = usePermissions();
  const query = useMessagingSettings(can("settings"));
  return { number: query.data?.defaultSenderNumber || undefined, settled: !isLoading && settled(query) };
}
