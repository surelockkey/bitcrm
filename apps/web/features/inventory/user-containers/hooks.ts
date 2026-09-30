"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserContainerAccess } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useUserMap } from "@/features/deals/hooks";
import { personName } from "@/features/deals/person-name";
import * as api from "./api";
import { accessLabel } from "./lib";

/** Every assignment row — one request for the whole team. */
export function useUserContainers(enabled = true) {
  return useQuery({
    queryKey: queryKeys.inventory.userContainers.list(),
    queryFn: api.listUserContainers,
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Save one user's assignment. Who works from which van shows on this tab, on
 * Containers, in the pickers and on the technician's own van — all refreshed.
 */
export function useAssignUserContainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, body }: { userId: string; body: api.AssignUserContainerBody }) =>
      api.assignUserContainer(userId, body),
    onSuccess: (row, { body }) => {
      qc.invalidateQueries({ queryKey: queryKeys.inventory.userContainers.all() });
      // `containers` covers the lists, every picker and "my container".
      qc.invalidateQueries({ queryKey: queryKeys.inventory.containers.all() });
      const who = body.userName;
      toast.success(
        row.access === UserContainerAccess.CONTAINER
          ? `${who} now works from ${row.containerName ?? "the container"}`
          : `${who}: ${accessLabel(row.access)}`,
      );
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/**
 * id → name for the people on the assignment rows. The directory when the
 * viewer may list users; otherwise just these ids, by name only.
 */
export function useUserNames(ids: string[]) {
  const { map, isLoading } = useUserMap(ids);
  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const [id, u] of map) {
      const name = personName(u);
      if (name) out.set(id, name);
    }
    return out;
  }, [map]);
  return { names, isLoading };
}
