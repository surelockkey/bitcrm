"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./call-devices-api";

/**
 * The Devices catalog (Workiz Phone → Devices): the desk phones and shop
 * lines a call group or a Forward step rings beside the softphones.
 */
export function useCallDevices(enabled = true) {
  return useQuery({
    queryKey: queryKeys.telephony.callDevices(),
    queryFn: api.listCallDevices,
    enabled,
  });
}

function useInvalidateCallDevices() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.telephony.callDevices() });
    // Groups name their devices from the catalog, so a rename shows there too.
    qc.invalidateQueries({ queryKey: queryKeys.telephony.callGroups() });
  };
}

export function useCreateCallDevice() {
  const invalidate = useInvalidateCallDevices();
  return useMutation({
    mutationFn: (body: api.CreateCallDeviceValues) => api.createCallDevice(body),
    onSuccess: (device) => {
      invalidate();
      toast.success(`Added ${device.name}`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateCallDevice(id: string) {
  const invalidate = useInvalidateCallDevices();
  return useMutation({
    mutationFn: (body: api.UpdateCallDeviceValues) => api.updateCallDevice(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Device saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteCallDevice() {
  const invalidate = useInvalidateCallDevices();
  return useMutation({
    mutationFn: (id: string) => api.deleteCallDevice(id),
    onSuccess: () => {
      invalidate();
      toast.success("Device removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}
