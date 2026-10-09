"use client";

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PaymentScheduleView, SavePaymentScheduleBody } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { deletePaymentSchedule, getPaymentSchedule, savePaymentSchedule } from "./schedule-api";

/** The job's Payment schedule (`null` when it has none). A payment refreshes it with the job's ledger. */
export function usePaymentSchedule(dealId: string, enabled = true) {
  return useQuery<PaymentScheduleView | null>({
    queryKey: queryKeys.payments.schedule(dealId),
    queryFn: () => getPaymentSchedule(dealId),
    enabled: enabled && !!dealId,
  });
}

/**
 * A schedule's dollars are its shares of the job total, worked out when it is
 * read: once the total moves (an item, the tax, the discount), read it again.
 */
export function useRefreshScheduleOnTotal(dealId: string, total: number) {
  const qc = useQueryClient();
  const seen = useRef(total);
  useEffect(() => {
    if (seen.current === total) return;
    seen.current = total;
    if (dealId) qc.invalidateQueries({ queryKey: queryKeys.payments.schedule(dealId) });
  }, [dealId, total, qc]);
}

/** Save: billing's answer goes straight into the cache before the window closes. */
export function useSavePaymentSchedule(dealId: string) {
  const qc = useQueryClient();
  return useMutation<PaymentScheduleView, unknown, SavePaymentScheduleBody>({
    mutationFn: (body) => savePaymentSchedule(dealId, body),
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.payments.schedule(dealId), view);
      toast.success("Payment schedule saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Couldn't save the payment schedule")),
  });
}

/** Delete schedule: the job goes back to "Add payment schedule". */
export function useDeletePaymentSchedule(dealId: string) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, void>({
    mutationFn: () => deletePaymentSchedule(dealId),
    onSuccess: () => {
      qc.setQueryData(queryKeys.payments.schedule(dealId), null);
      toast.success("Payment schedule deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "Couldn't delete the payment schedule")),
  });
}
