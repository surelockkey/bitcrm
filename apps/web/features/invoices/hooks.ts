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
import type { EstimateItemBody } from "@/features/estimates/schemas";
import * as api from "./api";
import type { InvoiceListParams } from "./lib";
import type { InvoicePatch } from "./schemas";

/* ------------------------------------------------------------- queries */

/** One invoice by its id — a client invoice's own page (a job's lives under `useInvoiceByDeal`). */
export function useInvoice(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.detail(id),
    queryFn: () => api.getInvoice(id),
    enabled: enabled && !!id,
  });
}

export function useInvoiceByDeal(dealId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.byDeal(dealId),
    queryFn: () => api.getInvoiceByDeal(dealId),
    enabled: enabled && !!dealId,
  });
}

/**
 * Скільки всього рядків під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useInvoiceCount(params: Omit<InvoiceListParams, "cursor">, enabled = true) {
  return useQuery({
    queryKey: queryKeys.invoices.count(params),
    queryFn: () => api.countInvoices(params),
    staleTime: 30_000,
    enabled,
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
 * Workiz's client card: Create new → Invoice makes the client's invoice with
 * no job at once (number from the account counter, due date from the client's
 * terms, no lines yet) and opens it.
 */
export function useCreateClientInvoice() {
  const qc = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (contactId: string) => api.createClientInvoice(contactId),
    onSuccess: (inv) => {
      qc.setQueryData(queryKeys.invoices.detail(inv.id), inv);
      invalidate();
      toast.success(`Invoice #${inv.number} created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** The cache entry an invoice's screen reads: the job's slot, or the invoice's own. */
const invoiceKey = (invoice: Pick<InvoiceView, "id" | "dealId">) =>
  invoice.dealId ? queryKeys.invoices.byDeal(invoice.dealId) : queryKeys.invoices.detail(invoice.id);

/* ---- lines of a CLIENT invoice (a job invoice's lines are the job's items) */

function useClientInvoiceLineMutation<V>(
  invoiceId: string,
  run: (vars: V) => Promise<InvoiceView>,
  done?: string,
) {
  const qc = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: run,
    onSuccess: (view) => {
      qc.setQueryData(queryKeys.invoices.detail(invoiceId), view);
      invalidate();
      if (done) toast.success(done);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAddInvoiceItem(invoiceId: string) {
  return useClientInvoiceLineMutation(invoiceId, (body: EstimateItemBody) => api.addInvoiceItem(invoiceId, body), "Item added");
}

export function useUpdateInvoiceItem(invoiceId: string) {
  return useClientInvoiceLineMutation(
    invoiceId,
    ({ lineId, body }: { lineId: string; body: EstimateItemBody }) => api.updateInvoiceItem(invoiceId, lineId, body),
    "Item updated",
  );
}

export function useDeleteInvoiceItem(invoiceId: string) {
  return useClientInvoiceLineMutation(invoiceId, (lineId: string) => api.deleteInvoiceItem(invoiceId, lineId), "Item removed");
}

export function useSetInvoiceItemTaxable(invoiceId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateInvoice();
  const key = queryKeys.invoices.detail(invoiceId);
  return useMutation({
    mutationFn: ({ lineId, taxable }: { lineId: string; taxable: boolean }) =>
      api.setInvoiceItemTaxable(invoiceId, lineId, taxable),
    onMutate: async ({ lineId, taxable }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InvoiceView>(key);
      if (previous) {
        qc.setQueryData<InvoiceView>(key, {
          ...previous,
          items: previous.items.map((i) => (i.lineId === lineId ? { ...i, taxable } : i)),
        });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(),
  });
}

/** Drag-and-drop order; the rows move before the server confirms. */
export function useReorderInvoiceItems(invoiceId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateInvoice();
  const key = queryKeys.invoices.detail(invoiceId);
  return useMutation({
    mutationFn: (lineIds: string[]) => api.reorderInvoiceItems(invoiceId, lineIds),
    onMutate: async (lineIds) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InvoiceView>(key);
      if (previous) {
        const byId = new Map(previous.items.map((i) => [i.lineId, i]));
        const items = lineIds
          .map((lineId, position) => {
            const item = byId.get(lineId);
            return item ? { ...item, position } : null;
          })
          .filter((i): i is NonNullable<typeof i> => i !== null);
        qc.setQueryData<InvoiceView>(key, { ...previous, items });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(),
  });
}

/**
 * Header edits (dates, terms, notes, template; a client invoice's tax and
 * discount too). Optimistic on the screen's cache entry so date pickers don't
 * flicker back while the PATCH is in flight — tax/discount wait for the
 * server's totals.
 */
export function useUpdateInvoice(invoice: Pick<InvoiceView, "id" | "dealId">) {
  const qc = useQueryClient();
  const invalidate = useInvalidateInvoice();
  const key = invoiceKey(invoice);
  return useMutation({
    mutationFn: (body: InvoicePatch) => api.updateInvoice(invoice.id, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<InvoiceView | null>(key);
      if (previous) {
        const { invoiceDate, paymentTerms, dueDate, notes, templateId } = body;
        qc.setQueryData<InvoiceView>(key, {
          ...previous,
          ...(invoiceDate !== undefined ? { invoiceDate } : {}),
          ...(paymentTerms !== undefined ? { paymentTerms } : {}),
          ...(dueDate !== undefined ? { dueDate } : {}),
          ...(notes !== undefined ? { notes } : {}),
          ...(templateId !== undefined ? { templateId: templateId ?? undefined } : {}),
        });
      }
      return { previous };
    },
    onSuccess: (view, body) => {
      qc.setQueryData(key, view);
      if (body.discount !== undefined) toast.success(body.discount ? "Discount applied" : "Discount removed");
      else if (body.taxRateId !== undefined) toast.success(body.taxRateId ? "Tax updated" : "Tax removed");
      else toast.success("Invoice saved");
    },
    onError: (e, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(invoice.dealId),
  });
}

export function useMarkInvoiceSent(dealId?: string) {
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

export function useDeleteInvoice(dealId?: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateInvoice();
  return useMutation({
    mutationFn: (id: string) => api.deleteInvoice(id),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: queryKeys.invoices.detail(id) });
      invalidate(dealId);
      toast.success(dealId ? "Invoice deleted — the job's items were kept" : "Invoice deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
