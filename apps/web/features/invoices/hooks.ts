"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Invoice, InvoiceView } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type { InvoiceListParams } from "./lib";
import type { InvoicePatch } from "./schemas";

/* ------------------------------------------------------------- queries */

export function useInvoiceByDeal(dealId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.byDeal(dealId),
    queryFn: () => api.getInvoiceByDeal(dealId),
    enabled: enabled && !!dealId,
  });
}

export function useInvoiceList(params: Omit<InvoiceListParams, "cursor">, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.invoices.list(params),
    queryFn: ({ pageParam }) => api.listInvoices({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}

export function useContactInvoices(contactId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.byContact(contactId),
    queryFn: () => api.fetchAllInvoices({ contactId }),
    enabled: enabled && !!contactId,
  });
}

export function useInvoiceSummary(enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.summary(),
    queryFn: api.getInvoiceSummary,
    enabled,
  });
}

export function useJobsNeedingInvoice(enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.needingInvoice(),
    queryFn: api.getJobsNeedingInvoice,
    enabled,
  });
}

/** A client's documents across several contacts (a company's roster), newest first. */
export function useInvoicesForContacts(contactIds: string[], enabled = true) {
  return useQueries({
    queries: contactIds.map((contactId) => ({
      queryKey: queryKeys.invoices.byContact(contactId),
      queryFn: () => api.fetchAllInvoices({ contactId }),
      enabled,
    })),
    combine: (results) => ({
      data: results
        .flatMap((r) => r.data ?? [])
        .sort((a: Invoice, b: Invoice) => b.createdAt.localeCompare(a.createdAt)),
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      error: results.find((r) => r.error)?.error ?? null,
    }),
  });
}

/* ----------------------------------------------------------- mutations */

/** Everything an invoice change can touch: lists, the job and its history. */
export function useInvalidateInvoice() {
  const qc = useQueryClient();
  return (dealId?: string) => {
    qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
    if (dealId) {
      qc.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.dealTotals(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
    }
    // The job list's needsInvoice view and the portal preview change too.
    qc.invalidateQueries({ queryKey: ["deals", "list"] });
    qc.invalidateQueries({ queryKey: ["portal"] });
  };
}

export function useCreateInvoice() {
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (dealId: string) => api.createInvoice(dealId),
    onSuccess: (inv, dealId) => {
      invalidate(dealId);
      toast.success(`Invoice #${inv.number} created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Header edits (dates, terms, notes, template). Optimistic on the by-deal
 * cache so date pickers don't flicker back while the PATCH is in flight.
 */
export function useUpdateInvoice(invoice: Pick<InvoiceView, "id" | "dealId">) {
  const qc = useQueryClient();
  const invalidate = useInvalidateInvoice();
  const key = queryKeys.invoices.byDeal(invoice.dealId);
  return useMutation({
    mutationFn: (body: InvoicePatch) => api.updateInvoice(invoice.id, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InvoiceView | null>(key);
      if (previous) {
        const { templateId, ...rest } = body;
        qc.setQueryData<InvoiceView>(key, {
          ...previous,
          ...rest,
          ...(templateId !== undefined ? { templateId: templateId ?? undefined } : {}),
        });
      }
      return { previous };
    },
    onSuccess: () => toast.success("Invoice saved"),
    onError: (e, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(invoice.dealId),
  });
}

export function useMarkInvoiceSent(dealId: string) {
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: ({ id, sent }: { id: string; sent: boolean }) => api.markInvoiceSent(id, sent),
    onSuccess: (_inv, { sent }) => {
      invalidate(dealId);
      toast.success(sent ? "Marked as sent" : "Marked as unsent");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteInvoice(dealId: string) {
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (id: string) => api.deleteInvoice(id),
    onSuccess: () => {
      invalidate(dealId);
      toast.success("Invoice deleted — the job's items were kept");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
