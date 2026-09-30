"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { InventoryStatus } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { ApiError, getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import { fillMessages } from "./lib";
import { refreshAfterMovement } from "@/features/inventory/stock/refresh";

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

const ALREADY_MADE = "That fill was already made — showing the van as it is now.";

/**
 * "Fill from warehouse". It is a transfer: both locations, the items'
 * `onHand`, the journal and every comparison with a template move with it.
 * The same request id twice is one fill: the repeat comes back `replayed`
 * (or 409 while the first is still running), and moves nothing.
 */
export function useFillFromWarehouse() {
  const qc = useQueryClient();
  const refreshDiffs = () => qc.invalidateQueries({ queryKey: queryKeys.inventory.containerTemplates.all() });
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: api.FillBody; containerName: string }) =>
      api.fillFromWarehouse(id, body),
    onSuccess: (result, { body, containerName }) => {
      // One warehouse → van transfer: both ends, the items that moved, the
      // journal — not the rest of the fleet.
      refreshAfterMovement(
        qc,
        [
          { type: "warehouse", id: body.warehouseId },
          { type: "container", id: body.containerId },
        ],
        [...result.moved, ...(result.transfer?.items ?? [])].map((i) => i.productId),
      );
      refreshDiffs();
      // The same request id again: the server hands back the first fill's
      // answer and moves nothing this time.
      if (result.replayed) {
        toast.info(ALREADY_MADE);
        return;
      }
      const { success, warning } = fillMessages(result, containerName);
      if (success) toast.success(success);
      if (warning) toast.warning(warning);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        refreshDiffs();
        toast.info(ALREADY_MADE);
        return;
      }
      toast.error(getApiErrorMessage(e));
    },
  });
}
