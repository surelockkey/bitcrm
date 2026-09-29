"use client";

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OnlinePaymentMethod } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatMoney } from "@/features/billing/lib";
import * as api from "./api";
import type { PaymentListParams } from "./lib";
import type { PaymentSettingsBody } from "./schemas";

/* ------------------------------------------------------------- queries */

export function useInvoicePayments(invoiceId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.payments.byInvoice(invoiceId),
    queryFn: () => api.getInvoicePayments(invoiceId),
    enabled: enabled && !!invoiceId,
  });
}

export function usePaymentList(params: Omit<PaymentListParams, "cursor">, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.payments.list(params),
    queryFn: ({ pageParam }) => api.listPayments({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}

/** The account's payment settings. Readable by anyone signed in. */
export function usePaymentSettings(enabled = true) {
  return useQuery({
    queryKey: queryKeys.payments.settings(),
    queryFn: api.getPaymentSettings,
    enabled,
    staleTime: 5 * 60_000,
  });
}

/* ----------------------------------------------------------- mutations */

/**
 * Everything a ledger change touches: the invoice's rows, the invoice itself
 * (its totals and status are derived from them), the job and its history, and
 * the /payments report.
 */
export function useInvalidateLedger(invoiceId: string, dealId?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.payments.byInvoice(invoiceId) });
    qc.invalidateQueries({ queryKey: queryKeys.payments.list() });
    qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
    if (dealId) {
      qc.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.dealTotals(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
    }
    qc.invalidateQueries({ queryKey: ["deals", "list"] });
  };
}

export function useRecordPayment(invoiceId: string, dealId?: string) {
  const invalidate = useInvalidateLedger(invoiceId, dealId);
  return useMutation({
    mutationFn: (body: api.RecordPaymentBody) => api.recordPayment(invoiceId, body),
    onSuccess: (payment) => {
      invalidate();
      toast.success(`Recorded ${formatMoney(payment.amount)}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, "The payment couldn't be recorded")),
  });
}

export function useRefundPayment(invoiceId: string, dealId?: string) {
  const invalidate = useInvalidateLedger(invoiceId, dealId);
  return useMutation({
    mutationFn: ({ paymentId, ...body }: api.RefundBody & { paymentId: string }) =>
      api.refundPayment(paymentId, body),
    onSuccess: (refund) => {
      invalidate();
      toast.success(
        refund.status === "pending"
          ? `Refund of ${formatMoney(refund.amount)} started`
          : `Refunded ${formatMoney(refund.amount)}`,
      );
    },
    // The dialog shows the message too — it stays open so the amount can be fixed.
    onError: (e) => toast.error(getApiErrorMessage(e, "The refund couldn't be sent")),
  });
}

export function useResendReceipt() {
  return useMutation({
    mutationFn: (paymentId: string) => api.resendReceipt(paymentId),
    onSuccess: (res) =>
      toast.success(res.sentTo ? `Receipt sent to ${res.sentTo}` : "Receipt sent"),
    onError: (e) => toast.error(getApiErrorMessage(e, "The receipt couldn't be sent")),
  });
}

export function useUpdatePaymentSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: PaymentSettingsBody) => api.updatePaymentSettings(body),
    onSuccess: (settings) => {
      qc.setQueryData(queryKeys.payments.settings(), settings);
      toast.success("Payment settings saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Saves the invoice's "Let client pay with" choice. Quiet — the send dialog reports. */
export function useSetAllowedMethods(invoiceId: string, dealId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (methods: OnlinePaymentMethod[] | null) => api.setAllowedMethods(invoiceId, methods),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
      if (dealId) qc.invalidateQueries({ queryKey: queryKeys.invoices.byDeal(dealId) });
    },
  });
}
