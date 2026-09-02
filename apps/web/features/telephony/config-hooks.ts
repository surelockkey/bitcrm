"use client";

import { useQuery } from "@tanstack/react-query";
import { fetchTelephonyConfig } from "./api";

/**
 * Workspace telephony settings the browser needs.
 *
 * Cached, because the shared technician line changes about as often as the
 * office moves and every job page would otherwise re-ask for it — but not for
 * long, because the window right after somebody designates a line is exactly
 * when another tab is looking at a job and wondering why the dial-in card says
 * it is not set up.
 */
export function useTelephonyConfig() {
  return useQuery({
    queryKey: ["telephony-config"],
    queryFn: fetchTelephonyConfig,
    staleTime: 5 * 60_000,
  });
}
