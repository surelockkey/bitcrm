import { http } from "@/lib/api/http";
import { ApiError } from "@/lib/api/errors";
import type { CallDevice, CallDeviceType } from "@bitcrm/types";

export type { CallDevice, CallDeviceType };

/** What the Devices tab's modal sends: a name and a number (or SIP address). */
export interface CreateCallDeviceValues {
  name: string;
  number?: string;
  sipAddress?: string;
  type?: CallDeviceType;
  active?: boolean;
}

/** An omitted field keeps its value; `number` / `sipAddress` as null clears it. */
export interface UpdateCallDeviceValues {
  name?: string;
  number?: string | null;
  sipAddress?: string | null;
  type?: CallDeviceType;
  active?: boolean;
}

const BASE = "/telephony/devices";

/**
 * The catalog. An API from before Devices has no such route: that reads as
 * no devices, so the builder and the groups still open.
 */
export const listCallDevices = async (): Promise<CallDevice[]> => {
  try {
    return await http.get<CallDevice[]>(BASE);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return [];
    throw e;
  }
};

export const createCallDevice = (body: CreateCallDeviceValues): Promise<CallDevice> =>
  http.post<CallDevice>(BASE, body);

export const updateCallDevice = (id: string, body: UpdateCallDeviceValues): Promise<CallDevice> =>
  http.put<CallDevice>(`${BASE}/${id}`, body);

export const deleteCallDevice = (id: string): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`${BASE}/${id}`);
