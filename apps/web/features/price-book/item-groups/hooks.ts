"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ItemGroup } from "@bitcrm/types";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type { ItemGroupBody, ItemGroupUpdateBody } from "./api";

/**
 * Every item group (active and disabled — the tab's status box and the
 * pickers narrow it), one request. `enabled` waits for the caller's
 * `products.view`; the server guards it anyway.
 */
export function useItemGroups(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.itemGroups.list("all"),
    queryFn: () => api.listItemGroups("all"),
    enabled,
    staleTime: 30_000,
  });
}

export function useCreateItemGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ItemGroupBody) => api.createItemGroup(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.itemGroups.all() });
      toast.success("Item group successfully created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/** Save, disable (`active: false`) and enable (`active: true`) are all this one PATCH. */
export function useUpdateItemGroup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ItemGroupUpdateBody }): Promise<ItemGroup> =>
      api.updateItemGroup(id, body),
    onSuccess: (_group, { body }) => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.itemGroups.all() });
      const onlyActive = Object.keys(body).length === 1 && body.active !== undefined;
      toast.success(onlyActive ? `Item group ${body.active ? "enabled" : "disabled"}` : "Item group successfully updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
