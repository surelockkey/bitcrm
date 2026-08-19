"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./call-flows-api";

export function useCallFlows(enabled = true) {
  return useQuery({
    queryKey: queryKeys.telephony.callFlows(),
    queryFn: api.listCallFlows,
    enabled,
  });
}

function useInvalidateCallFlows() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ queryKey: queryKeys.telephony.callFlows() });
}

/** Save the whole step graph — what the step editor uses. */
export function useSaveCallFlow(id?: string) {
  const invalidate = useInvalidateCallFlows();
  return useMutation({
    mutationFn: (body: api.CallFlowValues) =>
      id ? api.updateCallFlow(id, body) : api.createCallFlow(body),
    onSuccess: () => {
      invalidate();
      toast.success("Flow saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUploadFlowAudio() {
  return useMutation({
    mutationFn: (file: File) => api.uploadFlowAudio(file),
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useCreateCallFlow() {
  const invalidate = useInvalidateCallFlows();
  return useMutation({
    mutationFn: (body: api.SimpleFlowValues) => api.createSimpleFlow(body),
    onSuccess: (flow) => {
      invalidate();
      toast.success(`Created ${flow.name}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateCallFlow(id: string) {
  const invalidate = useInvalidateCallFlows();
  return useMutation({
    mutationFn: (body: api.SimpleFlowValues) => api.updateSimpleFlow(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Flow saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteCallFlow() {
  const invalidate = useInvalidateCallFlows();
  return useMutation({
    mutationFn: (id: string) => api.deleteCallFlow(id),
    onSuccess: () => {
      invalidate();
      toast.success("Flow deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
