"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { WorkOrderStatus } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type { WorkOrderFormValues } from "./schemas";

export function useWorkOrders(params: { companyId?: string; status?: WorkOrderStatus } = {}) {
  return useQuery({
    queryKey: queryKeys.workOrders.list(params),
    queryFn: () => api.listWorkOrders(params),
  });
}

function useInvalidateWorkOrders() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: queryKeys.workOrders.all() });
}

export function useCreateWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({
    mutationFn: (body: WorkOrderFormValues) => api.createWorkOrder(body),
    onSuccess: () => {
      invalidate();
      toast.success("Work order created");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteWorkOrder() {
  const invalidate = useInvalidateWorkOrders();
  return useMutation({
    mutationFn: (id: string) => api.deleteWorkOrder(id),
    onSuccess: ({ archived }) => {
      invalidate();
      toast.success(archived ? "Work order archived" : "Work order deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
