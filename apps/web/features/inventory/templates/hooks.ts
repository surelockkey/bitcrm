"use client";

import { useMutation, useQuery, useQueryClient, type Query } from "@tanstack/react-query";
import { toast } from "sonner";
import { InventoryStatus } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { ApiError, getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import { fillMessages } from "./lib";

/** One status at a time — the server answers the active ones by default. */
export function useContainerTemplates(status: InventoryStatus = InventoryStatus.ACTIVE, enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.containerTemplates.list(status),
    queryFn: () => api.listContainerTemplates(status),
    enabled,
    staleTime: 30_000,
  });
}

export function useContainerTemplate(id: string | undefined, enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.containerTemplates.detail(id ?? ""),
    queryFn: () => api.getContainerTemplate(id as string),
    enabled: enabled && !!id,
  });
}

/** How a van compares with the template — and, with a warehouse, what a fill would move. */
export function useTemplateDiff(
  id: string | undefined,
  containerId: string | undefined,
  warehouseId?: string,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.inventory.containerTemplates.diff(id ?? "", containerId ?? "", warehouseId),
    queryFn: () => api.getTemplateDiff(id as string, containerId as string, warehouseId),
    enabled: enabled && !!id && !!containerId,
    // 403 and 404 are answers about this van or warehouse, not blips.
    retry: false,
  });
}

function useInvalidateTemplates() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.inventory.containerTemplates.all() });
}

export function useCreateTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (body: api.CreateTemplateBody) => api.createContainerTemplate(body),
    onSuccess: (t) => {
      invalidate();
      toast.success(`Template “${t.name}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: api.UpdateTemplateBody }) =>
      api.updateContainerTemplate(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Template saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useArchiveTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (id: string) => api.archiveContainerTemplate(id),
    onSuccess: () => {
      invalidate();
      toast.success("Template archived");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useRestoreTemplate() {
  const invalidate = useInvalidateTemplates();
  return useMutation({
    mutationFn: (id: string) => api.updateContainerTemplate(id, { status: InventoryStatus.ACTIVE }),
    onSuccess: () => {
      invalidate();
      toast.success("Template restored");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** The item queries a transfer changes: `onHand` on the list and the popup, and the per-location split. */
const movedByStock = ({ queryKey: [root, second, third] }: Query) =>
  root === "products" && (second === "list" || second === "detail" || third === "stock");

/**
 * "Fill from warehouse". It is a transfer: both locations, the items'
 * `onHand`, the journal and every comparison with a template move with it.
 * A 409 is the same request id arriving twice — the fill was made once.
 */
export function useFillFromWarehouse() {
  const qc = useQueryClient();
  const refreshDiffs = () => qc.invalidateQueries({ queryKey: queryKeys.inventory.containerTemplates.all() });
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: api.FillBody; containerName: string }) =>
      api.fillFromWarehouse(id, body),
    onSuccess: (result, { containerName }) => {
      qc.invalidateQueries({ predicate: movedByStock });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.containers.all() });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.warehouses.all() });
      qc.invalidateQueries({ queryKey: queryKeys.inventory.transfers.all() });
      refreshDiffs();
      const { success, warning } = fillMessages(result, containerName);
      if (success) toast.success(success);
      if (warning) toast.warning(warning);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        refreshDiffs();
        toast.info("That fill was already made — showing the van as it is now.");
        return;
      }
      toast.error(getApiErrorMessage(e));
    },
  });
}
