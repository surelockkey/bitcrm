"use client";

import {
  useInfiniteQuery,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Estimate, EstimateStatus, EstimateWithItems } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import { estimateStatusLabel, type EstimateListParams } from "./lib";
import type { EstimateItemBody } from "./schemas";

/* ------------------------------------------------------------- queries */

export function useDealEstimates(dealId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.estimates.byDeal(dealId),
    queryFn: () => api.getEstimatesByDeal(dealId),
    enabled: enabled && !!dealId,
  });
}

export function useEstimate(id: string) {
  return useQuery({
    queryKey: queryKeys.estimates.detail(id),
    queryFn: () => api.getEstimate(id),
    enabled: !!id,
  });
}

/**
 * Скільки всього рядків під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useEstimateCount(params: Omit<EstimateListParams, "cursor">, enabled = true) {
  return useQuery({
    queryKey: queryKeys.estimates.count(params),
    queryFn: () => api.countEstimates(params),
    staleTime: 30_000,
    enabled,
  });
}

export function useEstimateList(params: Omit<EstimateListParams, "cursor">, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.estimates.list(params),
    queryFn: ({ pageParam }) => api.listEstimates({ ...params, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor || undefined,
    enabled,
  });
}

export function useContactEstimates(contactId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.estimates.byContact(contactId),
    queryFn: () => api.fetchAllEstimates({ contactId }),
    enabled: enabled && !!contactId,
  });
}

export function useEstimateSummary(enabled = true) {
  return useQuery({
    queryKey: queryKeys.estimates.summary(),
    queryFn: api.getEstimateSummary,
    enabled,
  });
}

/** A client's documents across several contacts (a company's roster), newest first. */
export function useEstimatesForContacts(contactIds: string[], enabled = true) {
  return useQueries({
    queries: contactIds.map((contactId) => ({
      queryKey: queryKeys.estimates.byContact(contactId),
      queryFn: () => api.fetchAllEstimates({ contactId }),
      enabled,
    })),
    combine: (results) => ({
      data: results
        .flatMap((r) => r.data ?? [])
        .sort((a: Estimate, b: Estimate) => b.createdAt.localeCompare(a.createdAt)),
      isLoading: results.some((r) => r.isLoading),
      isError: results.some((r) => r.isError),
      error: results.find((r) => r.error)?.error ?? null,
    }),
  });
}

/* ----------------------------------------------------------- mutations */

function useInvalidateEstimates() {
  const qc = useQueryClient();
  return (dealId?: string) => {
    qc.invalidateQueries({ queryKey: queryKeys.estimates.all() });
    if (dealId) qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
    qc.invalidateQueries({ queryKey: ["portal"] });
  };
}

/** Seed the detail cache with a full estimate the server just returned. */
function usePutDetail() {
  const qc = useQueryClient();
  return (e: EstimateWithItems | undefined) => {
    if (e && Array.isArray(e.items)) qc.setQueryData(queryKeys.estimates.detail(e.id), e);
  };
}

export function useCreateEstimate(dealId: string) {
  const invalidate = useInvalidateEstimates();
  const put = usePutDetail();
  return useMutation({
    mutationFn: (body: { name?: string; copyJobItems?: boolean }) => api.createEstimate({ dealId, ...body }),
    onSuccess: (e) => {
      put(e);
      invalidate(dealId);
      toast.success(`Estimate #${e.number} created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateEstimate(id: string, dealId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimates();
  const key = queryKeys.estimates.detail(id);
  return useMutation({
    mutationFn: (body: api.EstimatePatch) => api.updateEstimate(id, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<EstimateWithItems>(key);
      // Header fields paint immediately; tax/discount wait for server totals.
      if (previous) {
        const { name, estimateDate, notes } = body;
        qc.setQueryData<EstimateWithItems>(key, {
          ...previous,
          ...(name !== undefined ? { name } : {}),
          ...(estimateDate !== undefined ? { estimateDate } : {}),
          ...(notes !== undefined ? { notes } : {}),
        });
      }
      return { previous };
    },
    onSuccess: (_e, body) => {
      if (body.discount !== undefined) toast.success(body.discount ? "Discount applied" : "Discount removed");
      else if (body.taxRateId !== undefined) toast.success(body.taxRateId ? "Tax updated" : "Tax removed");
      else toast.success("Estimate saved");
    },
    onError: (e, _b, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(dealId),
  });
}

export function useSetEstimateStatus(id: string, dealId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimates();
  const key = queryKeys.estimates.detail(id);
  return useMutation({
    mutationFn: (status: EstimateStatus) => api.setEstimateStatus(id, status),
    onMutate: async (status) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<EstimateWithItems>(key);
      if (previous) qc.setQueryData<EstimateWithItems>(key, { ...previous, status });
      return { previous };
    },
    onSuccess: (_e, status) => toast.success(`Status set to ${estimateStatusLabel(status)}`),
    onError: (e, _s, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(dealId),
  });
}

export function useAddEstimateItem(id: string, dealId: string) {
  const invalidate = useInvalidateEstimates();
  return useMutation({
    mutationFn: (body: EstimateItemBody) => api.addEstimateItem(id, body),
    onSuccess: () => {
      invalidate(dealId);
      toast.success("Item added");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateEstimateItem(id: string, dealId: string) {
  const invalidate = useInvalidateEstimates();
  return useMutation({
    mutationFn: ({ lineId, body }: { lineId: string; body: EstimateItemBody }) =>
      api.updateEstimateItem(id, lineId, body),
    onSuccess: () => {
      invalidate(dealId);
      toast.success("Item updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useSetEstimateItemTaxable(id: string, dealId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimates();
  const key = queryKeys.estimates.detail(id);
  return useMutation({
    mutationFn: ({ lineId, taxable }: { lineId: string; taxable: boolean }) =>
      api.setEstimateItemTaxable(id, lineId, taxable),
    onMutate: async ({ lineId, taxable }) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<EstimateWithItems>(key);
      if (previous) {
        qc.setQueryData<EstimateWithItems>(key, {
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
    onSettled: () => invalidate(dealId),
  });
}

export function useDeleteEstimateItem(id: string, dealId: string) {
  const invalidate = useInvalidateEstimates();
  return useMutation({
    mutationFn: (lineId: string) => api.deleteEstimateItem(id, lineId),
    onSuccess: () => {
      invalidate(dealId);
      toast.success("Item removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Drag-and-drop order; the rows move before the server confirms. */
export function useReorderEstimateItems(id: string, dealId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimates();
  const key = queryKeys.estimates.detail(id);
  return useMutation({
    mutationFn: (lineIds: string[]) => api.reorderEstimateItems(id, lineIds),
    onMutate: async (lineIds) => {
      await qc.cancelQueries({ queryKey: key });
      const previous = qc.getQueryData<EstimateWithItems>(key);
      if (previous) {
        const byId = new Map(previous.items.map((i) => [i.lineId, i]));
        const items = lineIds
          .map((lineId, position) => {
            const item = byId.get(lineId);
            return item ? { ...item, position } : null;
          })
          .filter((i): i is NonNullable<typeof i> => i !== null);
        qc.setQueryData<EstimateWithItems>(key, { ...previous, items });
      }
      return { previous };
    },
    onError: (e, _v, ctx) => {
      if (ctx?.previous) qc.setQueryData(key, ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(dealId),
  });
}

export function useDuplicateEstimate(dealId: string) {
  const invalidate = useInvalidateEstimates();
  const put = usePutDetail();
  return useMutation({
    mutationFn: (id: string) => api.duplicateEstimate(id),
    onSuccess: (e) => {
      put(e);
      invalidate(dealId);
      toast.success(`Duplicated as estimate #${e.number}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useMarkEstimateSent(id: string, dealId: string) {
  const invalidate = useInvalidateEstimates();
  return useMutation({
    mutationFn: (sent: boolean) => api.markEstimateSent(id, sent),
    onSuccess: (_e, sent) => {
      invalidate(dealId);
      toast.success(sent ? "Marked as sent" : "Marked as unsent");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Overwrite the job's items with the estimate's — refreshes the whole job. */
export function useSyncEstimateToJob(id: string, dealId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimates();
  const put = usePutDetail();
  return useMutation({
    mutationFn: () => api.syncEstimateToJob(id),
    onSuccess: ({ estimate, itemCount }) => {
      put(estimate);
      invalidate(dealId);
      qc.invalidateQueries({ queryKey: queryKeys.deals.detail(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.products(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.dealTotals(dealId) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
      qc.invalidateQueries({ queryKey: ["deals", "list"] });
      qc.invalidateQueries({ queryKey: queryKeys.invoices.all() });
      toast.success(`Job items replaced — ${itemCount} item${itemCount === 1 ? "" : "s"} synced from the estimate`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteEstimate(dealId: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateEstimates();
  return useMutation({
    mutationFn: (id: string) => api.deleteEstimate(id),
    onSuccess: (_r, id) => {
      qc.removeQueries({ queryKey: queryKeys.estimates.detail(id) });
      invalidate(dealId);
      toast.success("Estimate deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
