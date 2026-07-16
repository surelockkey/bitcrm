"use client";

import { useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { Contact, DealStage, User } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { fetchAllContacts } from "@/features/clients/api";
import { fetchAllUsers } from "@/features/technicians/api";
import * as api from "./api";
import type { CreateDealValues, UpdateDealValues, AddProductValues } from "./schemas";

/* ------------------------------------------------------------- queries */

/** Dispatch board polls so the map stays live (story 4.01). */
export const DEALS_POLL_MS = 30_000;

export function useDeals(
  params: { stage?: DealStage; techId?: string } = {},
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

export function useAllowedStages(id: string) {
  return useQuery({
    queryKey: queryKeys.deals.allowedStages(id),
    queryFn: () => api.getAllowedStages(id),
  });
}

export function useQualifiedTechs(id: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.deals.qualifiedTechs(id),
    queryFn: () => api.getQualifiedTechs(id),
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
      qc.invalidateQueries({ queryKey: queryKeys.deals.allowedStages(id) });
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

export function useChangeStage(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: ({ stage, cancellationReason }: { stage: DealStage; cancellationReason?: string }) =>
      api.changeStage(id, stage, cancellationReason),
    onSuccess: () => invalidate(),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useAssignTech(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: (techId: string) => api.assignTech(id, techId),
    onSuccess: () => {
      invalidate();
      toast.success("Technician assigned");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUnassignTech(id: string) {
  const invalidate = useInvalidateDeal(id);
  return useMutation({
    mutationFn: () => api.unassignTech(id),
    onSuccess: () => {
      invalidate();
      toast.success("Technician unassigned");
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
