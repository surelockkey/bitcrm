"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./numbers-api";

/** The account's owned numbers. Used by both the Settings page and the dialer. */
export function useNumbers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.telephony.numbers(),
    queryFn: api.listNumbers,
    enabled,
    staleTime: 60_000,
  });
}

/** Purchasable numbers for a given search (only runs once a search is set). */
export function useAvailableNumbers(
  params: api.AvailableSearch,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.telephony.available(params),
    queryFn: () => api.searchAvailableNumbers(params),
    enabled,
  });
}

function useInvalidateNumbers() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: queryKeys.telephony.numbers() });
}

export function useBuyNumber() {
  const invalidate = useInvalidateNumbers();
  return useMutation({
    mutationFn: (phoneNumber: string) => api.buyNumber(phoneNumber),
    onSuccess: (n) => {
      invalidate();
      toast.success(`Bought ${n.phoneNumber}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useReleaseNumber() {
  const invalidate = useInvalidateNumbers();
  return useMutation({
    mutationFn: (sid: string) => api.releaseNumber(sid),
    onSuccess: () => {
      invalidate();
      toast.success("Number released");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Local key until the catalogs branch lands its query-keys reshuffle. */
const NUMBER_SETTINGS_KEY = ["telephony", "number-settings"] as const;

/** Per-number job-source assignments (call tracking). */
export function useNumberSettings(enabled = true) {
  return useQuery({
    queryKey: NUMBER_SETTINGS_KEY,
    queryFn: api.listNumberSettings,
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdateNumberSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      phoneNumber,
      sourceId,
    }: {
      phoneNumber: string;
      sourceId: string | null;
    }) => api.updateNumberSettings(phoneNumber, sourceId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: NUMBER_SETTINGS_KEY });
      toast.success("Number source updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
