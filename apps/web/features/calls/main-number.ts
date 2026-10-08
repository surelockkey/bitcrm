"use client";

import { settled } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useMessagingSettings } from "@/features/messaging/hooks";
import { useTelephonyConfig } from "@/features/telephony/config-hooks";

/**
 * The workspace's own number — the pill beside Workiz's "Workiz Phone"
 * heading ("(203) 403-6303").
 *
 * `GET /telephony/config` serves it to every viewer as `mainNumber` (the
 * messaging default sender, else the workspace caller id; null = no pill). A
 * server from before that field reads as "not said": then the pill falls
 * back to the messaging default sender itself, which needs `settings.view`.
 * `settled` once that is known.
 */
export function useMainNumber(): { number?: string; settled: boolean } {
  const { can, isLoading } = usePermissions();
  const config = useTelephonyConfig();
  const said = !!config.data && "mainNumber" in config.data;
  const fallback = useMessagingSettings(settled(config) && !said && can("settings"));

  if (said) return { number: config.data?.mainNumber || undefined, settled: true };
  return {
    number: fallback.data?.defaultSenderNumber || undefined,
    settled: !isLoading && settled(config) && settled(fallback),
  };
}
