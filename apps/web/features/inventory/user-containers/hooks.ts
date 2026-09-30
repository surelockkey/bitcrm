"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserContainerAccess } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { personName } from "@/features/deals/person-name";
import { getUserNames } from "@/features/users/api";
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

/** `POST /users/by-ids` takes this many at most. */
const BY_IDS_CAP = 200;

/**
 * id → name for the assignment rows that carry only an id (the backfill's).
 * Just those ids, by name only — `POST /users/by-ids` needs no `users.view`,
 * and a few names are not worth reading the whole users directory for.
 */
export function useUserNames(ids: string[]) {
  // Sorted and de-duplicated so the cache key is stable across renders.
  const wanted = useMemo(() => [...new Set(ids)].filter(Boolean).sort().slice(0, BY_IDS_CAP), [ids]);
  const query = useQuery({
    queryKey: ["user-names", wanted],
    queryFn: () => getUserNames(wanted),
    enabled: wanted.length > 0,
    staleTime: 5 * 60 * 1000,
  });
  const names = useMemo(() => {
    const out = new Map<string, string>();
    for (const u of query.data ?? []) {
      const name = personName(u);
      if (name) out.set(u.id, name);
    }
    return out;
  }, [query.data]);
  return { names, isLoading: query.isLoading && wanted.length > 0 };
}
