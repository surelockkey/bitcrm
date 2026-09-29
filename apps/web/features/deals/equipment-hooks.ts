"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { DealEquipmentInput } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./equipment-api";

export function useEquipment(dealId: string) {
  return useQuery({
    queryKey: queryKeys.deals.equipment(dealId),
    queryFn: () => api.listEquipment(dealId),
  });
}

/** Every change also lands on the job's timeline, so that refreshes too. */
function useRefresh(dealId: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.deals.equipment(dealId) });
    qc.invalidateQueries({ queryKey: queryKeys.deals.timeline(dealId) });
  };
}

export function useCreateEquipment(dealId: string) {
  const refresh = useRefresh(dealId);
  return useMutation({
    mutationFn: (body: DealEquipmentInput) => api.createEquipment(dealId, body),
    onSuccess: () => {
      refresh();
      toast.success("Equipment added");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateEquipment(dealId: string) {
  const refresh = useRefresh(dealId);
  return useMutation({
    mutationFn: ({ equipmentId, body }: { equipmentId: string; body: api.EquipmentPatch }) =>
      api.updateEquipment(dealId, equipmentId, body),
    onSuccess: () => {
      refresh();
      toast.success("Equipment updated");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteEquipment(dealId: string) {
  const refresh = useRefresh(dealId);
  return useMutation({
    mutationFn: (equipmentId: string) => api.deleteEquipment(dealId, equipmentId),
    onSuccess: () => {
      refresh();
      toast.success("Equipment removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
