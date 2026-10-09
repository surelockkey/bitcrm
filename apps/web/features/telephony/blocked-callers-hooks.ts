"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import * as api from "./blocked-callers-api";

/**
 * The whole block list (Workiz Phone → Blocked callers), in one request: the
 * grid searches, sorts and pages it on the client as Workiz's react-table
 * does. `enabled` lets a caller skip the request when the viewer lacks
 * `calls.block` (the route would 403).
 */
export function useBlockedCallers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.telephony.blockedCallers(),
    queryFn: () => api.listBlockedCallers(),
    enabled,
  });
}

function useInvalidateBlockedCallers() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.telephony.blockedCallers() });
}

/**
 * Block a number. No error toast: the "Block a Number" form shows the
 * refusal in place (an already-blocked number, a bad number).
 */
export function useBlockCaller() {
  const invalidate = useInvalidateBlockedCallers();
  return useMutation({
    mutationFn: (body: api.BlockCallerValues) => api.blockCaller(body),
    onSuccess: (row) => {
      invalidate();
      toast.success(`${formatPhone(row.number)} blocked`);
    },
  });
}

export function useUnblockCaller() {
  const invalidate = useInvalidateBlockedCallers();
  return useMutation({
    mutationFn: (number: string) => api.unblockCaller(number),
    onSuccess: (result) => {
      invalidate();
      toast.success(`${formatPhone(result.number)} unblocked`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
