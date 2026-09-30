"use client";

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { OnlinePaymentMethod, PaymentReportQuery } from "@bitcrm/types";
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

/** The job's Payments tab — the same ledger, with or without an invoice. */
export function useDealPayments(dealId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.payments.byDeal(dealId),
    queryFn: () => api.getDealPayments(dealId),
    enabled: enabled && !!dealId,
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

/**
 * Workiz Reports → Payments, paged by cursor (Workiz's ‹ › arrows). The
 * first page carries the totals of the WHOLE range — the two cards and the
 * "of N".
 */
export function usePaymentReport(params: Omit<PaymentReportQuery, "cursor">, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.payments.report(params),
    queryFn: ({ pageParam }) => api.getPaymentReport({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    placeholderData: keepPreviousData,
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
    qc.invalidateQueries({ queryKey: ["payments", "report"] });
    qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
    if (dealId) {
      qc.invalidateQueries({ queryKey: queryKeys.payments.byDeal(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.dealTotals(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
    }
    qc.invalidateQueries({ queryKey: ["deals", "list"] });
  };
}

/**
 * Where a recorded payment goes: `invoice` (the default) posts to the
 * invoice's ledger and needs an invoice; `job` posts to the job's, which
 * works without one. The ledger is the same (invoice id === job id).
 */
export type RecordPaymentTarget = "invoice" | "job";

export function useRecordPayment(invoiceId: string, dealId?: string, target: RecordPaymentTarget = "invoice") {
  const invalidate = useInvalidateLedger(invoiceId, dealId);
  return useMutation({
    mutationFn: (body: api.RecordPaymentBody) =>
      target === "job" && dealId ? api.recordDealPayment(dealId, body) : api.recordPayment(invoiceId, body),
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
