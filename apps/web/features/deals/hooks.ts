"use client";

import { useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Contact, Deal, JobSuperStatus, User } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage, getMissingCloseFields } from "@/lib/api/errors";
import { fetchAllContacts } from "@/features/clients/api";
import { fetchAllUsers } from "@/features/technicians/api";
import * as api from "./api";
import type { CreateDealValues, UpdateDealValues, AddProductValues } from "./schemas";

/* ------------------------------------------------------------- queries */

/** Dispatch board polls so the map stays live (story 4.01). */
export const DEALS_POLL_MS = 30_000;

export function useDeals(
  params: { superStatus?: JobSuperStatus; techId?: string } = {},
  options: { poll?: boolean } = {},
) {
  return useQuery({
    queryKey: queryKeys.deals.list(params),
    queryFn: () => api.fetchAllDeals(params),
    refetchInterval: options.poll ? DEALS_POLL_MS : false,
  });
}

export function useDeal(id: string) {
  return useQuery({
    queryKey: queryKeys.deals.detail(id),
    queryFn: () => api.getDeal(id),
  });
}

export function useDealProducts(id: string) {
  return useQuery({
    queryKey: queryKeys.deals.products(id),
    queryFn: () => api.getDealProducts(id),
  });
}

export function useDealTimeline(id: string) {
  return useInfiniteQuery({
    queryKey: queryKeys.deals.timeline(id),
    queryFn: ({ pageParam }) => api.getTimeline(id, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
  });
}


export function useQualifiedTechs(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.deals.qualifiedTechs(id),
    queryFn: () => api.getQualifiedTechs(id),
    enabled,
  });
}

/** Suggested techs for a New Job — by job type, resolved area and address point. */
export function useSuggestedTechs(
  params: { jobTypeId?: string; serviceAreaId?: string; lat?: number; lng?: number },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ["deals", "suggested-techs", params],
    queryFn: () => api.suggestQualifiedTechs(params),
    enabled,
  });
}

/* --------------------------------------------------------------- joins */

/** contactId → Contact, shared with the Clients cache. */
export function useContactMap() {
  const q = useQuery({
    queryKey: queryKeys.contacts.list({ companyId: undefined }),
    queryFn: () => fetchAllContacts(),
  });
  const map = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of q.data ?? []) m.set(c.id, c);
    return m;
  }, [q.data]);
  return { map, isLoading: q.isLoading };
}

/** userId → User (technicians + dispatchers), shared with the Technicians cache. */
export function useUserMap() {
  const q = useQuery({
    queryKey: queryKeys.technicians.userMap(),
    queryFn: () => fetchAllUsers(),
  });
  const map = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of q.data ?? []) m.set(u.id, u);
    return m;
  }, [q.data]);
  return { map, users: q.data ?? [], isLoading: q.isLoading };
}

/* ----------------------------------------------------------- mutations */

function useInvalidateDeal(id?: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
    if (id) {
      qc.invalidateQueries({ queryKey: queryKeys.deals.detail(id) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.products(id) });
      qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(id) });
    }
  };
}

export function useCreateDeal() {
  const invalidate = useInvalidateDeal();
  return useMutation({
    mutationFn: (body: CreateDealValues) => api.createDeal(body),
    onSuccess: (d) => {
      invalidate();
      toast.success(`Deal #${d.dealNumber} created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateDeal(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (body: UpdateDealValues) => api.updateDeal(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Deal saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Re-point this job at another client — used when the details captured during a
 * call turn out to belong to somebody else.
 */
export function useChangeDealClient(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (contactId: string) => api.changeDealClient(id, contactId),
    onSuccess: () => {
      invalidate();
      // The new client's own job list gains this one.
      qc.invalidateQueries({ queryKey: queryKeys.contacts.all() });
      toast.success("Job moved to the new client");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * Tags auto-save immediately (no Save button) and are optimistic: the chip
 * paints before the server round-trip, rolls back on error, reconciles on
 * settle. The success toast is left to the caller so it can say "Tag added"
 * vs "Tag removed".
 */
export function useSetDealTags(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (tagIds: string[]) => api.updateDeal(id, { tagIds }),
    onMutate: async (tagIds) => {
      await qc.cancelQueries({ queryKey: queryKeys.deals.detail(id) });
      const previous = qc.getQueryData<Deal>(queryKeys.deals.detail(id));
      if (previous) {
        qc.setQueryData<Deal>(queryKeys.deals.detail(id), { ...previous, tagIds });
      }
      return { previous };
    },
    onError: (e, _tagIds, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.deals.detail(id), ctx.previous);
      toast.error(getApiErrorMessage(e));
    },
    onSettled: () => invalidate(),
  });
}

/**
 * Move a deal's status (super-status + optional sub-status). Auto-saves and is
 * optimistic so the new status paints before the round-trip; the success toast
 * is left to the caller. Gated server-side by deals.move_status.
 */
export function useMoveStatus(id: string) {
  const qc = useQueryClient();
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (body: api.MoveStatusBody) => api.moveStatus(id, body),
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: queryKeys.deals.detail(id) });
      const previous = qc.getQueryData<Deal>(queryKeys.deals.detail(id));
      if (previous) {
        qc.setQueryData<Deal>(queryKeys.deals.detail(id), {
          ...previous,
          superStatus: body.superStatus,
          subStatusId: body.subStatusId || undefined,
        });
      }
      return { previous };
    },
    onError: (e, _body, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKeys.deals.detail(id), ctx.previous);
      // A required-to-close gate (422) rolls the status back and tells the user
      // exactly which custom fields to fill — they stay on the job to fill them
      // (in the Custom fields section) and retry. Any other error is plain.
      const missing = getMissingCloseFields(e);
      if (missing) {
        const names = missing.map((f) => f.name).join(", ");
        toast.error(`Fill these required fields before closing the job: ${names}`);
      } else {
        toast.error(getApiErrorMessage(e));
      }
    },
    onSettled: () => invalidate(),
  });
}

export function useDeleteDeal() {
  const invalidate = useInvalidateDeal();
  return useMutation({
    mutationFn: (id: string) => api.deleteDeal(id),
    onSuccess: () => {
      invalidate();
      toast.success("Deal deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAssignTechs(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (techIds: string[]) => api.assignTechs(id, techIds),
    onSuccess: () => {
      invalidate();
      toast.success("Technicians updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUnassignTech(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (techId: string) => api.unassignTech(id, techId),
    onSuccess: () => {
      invalidate();
      toast.success("Technician removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Reorder a technician's jobs, then refresh the board so badges catch up. */
export function useReorderDeals() {
  const invalidate = useInvalidateDeal();
  return useMutation({
    mutationFn: ({ techId, orderedDealIds }: { techId: string; orderedDealIds: string[] }) =>
      api.reorderDeals(techId, orderedDealIds),
    onSuccess: () => {
      invalidate();
      toast.success("Job order updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAddNote(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (note: string) => api.addNote(id, note),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateNote(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: ({ entryId, timestamp, note }: { entryId: string; timestamp: string; note: string }) =>
      api.updateNote(id, entryId, { note, timestamp }),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteNote(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: ({ entryId, timestamp }: { entryId: string; timestamp: string }) =>
      api.deleteNote(id, entryId, timestamp),
    onSuccess: () => {
      invalidate();
      toast.success("Note deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAddProduct(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (body: AddProductValues) => api.addDealProduct(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Product added");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useReplaceProduct(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: ({ productId, body }: { productId: string; body: AddProductValues }) =>
      api.replaceDealProduct(id, productId, body),
    onSuccess: () => {
      invalidate();
      toast.success("Item updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useRemoveProduct(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (productId: string) => api.removeDealProduct(id, productId),
    onSuccess: () => {
      invalidate();
      toast.success("Product removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useMarkProductOrdered(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: ({ productId, ordered }: { productId: string; ordered: boolean }) =>
      api.markDealProductOrdered(id, productId, ordered),
    onSuccess: (_data, { ordered }) => {
      invalidate();
      toast.success(ordered ? "Marked as ordered" : "Marked as not ordered");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
