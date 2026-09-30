"use client";

import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useLocationStock } from "@/features/inventory/stock/hooks";
import { refreshLocationRows } from "@/features/inventory/stock/refresh";
import type { Container } from "@bitcrm/types";
import { rowFromLists } from "@/features/inventory/seed-from-lists";
import * as api from "./api";

/**
 * Скільки всього рядків під тими самими фільтрами — з цього панель робить
 * «Page 2 of 7». Сервер тримає число тридцять секунд, тож і тут стільки ж.
 */
export function useContainersCount(filter: api.ContainerFilter) {
  return useQuery({
    // The previous page stays on screen (dimmed) while a new filter or size loads.
    placeholderData: keepPreviousData,
    queryKey: queryKeys.inventory.containers.count(filter),
    queryFn: () => api.countContainers(filter),
    staleTime: 30_000,
  });
}

export function useContainersList(filter: api.ContainerFilter, limit = 100) {
  return useInfiniteQuery({
    // The previous page stays on screen (dimmed) while a new filter or size loads.
    placeholderData: keepPreviousData,
    queryKey: queryKeys.inventory.containers.list({ ...filter, limit }),
    queryFn: ({ pageParam }) => api.listContainers(filter, pageParam, limit),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    // A quick return to the tab reads nothing; a stock write refreshes it explicitly.
    staleTime: 30_000,
  });
}

/** One van — starting from its list row when a list holds it, read fresh behind it. */
export function useContainer(id: string, enabled = true) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: queryKeys.inventory.containers.detail(id),
    queryFn: () => api.getContainer(id),
    enabled,
    placeholderData: () => rowFromLists<Container>(qc, "containers", id),
  });
}

export function useCreateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: api.CreateContainerBody) => api.createContainer(body),
    onSuccess: (c) => {
      refreshLocationRows(qc, "containers");
      toast.success(`Container “${c.name}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: api.UpdateContainerBody }) =>
      api.updateContainer(id, body),
    onSuccess: (_c, { id }) => {
      refreshLocationRows(qc, "containers", id);
      toast.success("Container saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** The caller's own van — `null` when they have none (see `fetchMyContainer`). */
export function useMyContainer() {
  return useQuery({
    queryKey: queryKeys.inventory.containers.mine(),
    queryFn: api.fetchMyContainer,
    // A 404 is an answer, not a blip.
    retry: false,
  });
}

/** What one van holds — one request, named and priced by the server. */
export function useContainerStockView(id: string, enabled = true) {
  return useLocationStock("container", id, enabled);
}
