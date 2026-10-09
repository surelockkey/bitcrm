"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/api/errors";
import { fetchJobCode, fetchTelephonyConfig, setFallbackNumber } from "./api";

/**
 * Workiz's Fallback Number (the first row of its Call flows tab): where a
 * call goes when its flow ends unanswered. Set with any format, cleared with
 * null; the config every page reads is refreshed on the way back.
 */
export function useSetFallbackNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (phoneNumber: string | null) => setFallbackNumber(phoneNumber),
    onSuccess: (_data, phoneNumber) => {
      qc.invalidateQueries({ queryKey: ["telephony-config"] });
      toast.success(phoneNumber ? "Fallback number saved" : "Fallback number removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

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

/** The code a caller keys to reach this job from any phone. */
export function useJobCode(dealId: string) {
  return useQuery({
    queryKey: ["job-code", dealId],
    queryFn: () => fetchJobCode(dealId),
    staleTime: 5 * 60_000,
  });
}
