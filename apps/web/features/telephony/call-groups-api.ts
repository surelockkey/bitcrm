import { http } from "@/lib/api/http";
import type {
  CallGroupChannel,
  CallGroupMember,
  CallGroupType,
  CallGroupWithMembers,
} from "@bitcrm/types";

export type { CallGroupWithMembers, CallGroupChannel, CallGroupType };

/** A device ticked in the group's grid: its catalog id and its place in the ring order. */
export interface CallGroupDeviceMemberValues {
  deviceId: string;
  order?: number;
  enabled?: boolean;
}

export interface CreateCallGroupValues {
  name: string;
  description?: string;
  type?: CallGroupType;
  members?: Array<Pick<CallGroupMember, "userId" | "channel">>;
  /** Devices rung beside the people (Workiz's "Users and devices"). */
  deviceMembers?: CallGroupDeviceMemberValues[];
  active?: boolean;
  ringSeconds?: number;
}

export type UpdateCallGroupValues = Partial<
  Omit<CreateCallGroupValues, "members">
>;

export const listCallGroups = (): Promise<CallGroupWithMembers[]> =>
  http.get<CallGroupWithMembers[]>("/telephony/call-groups");

export const getCallGroup = (id: string): Promise<CallGroupWithMembers> =>
  http.get<CallGroupWithMembers>(`/telephony/call-groups/${id}`);

export const createCallGroup = (
  body: CreateCallGroupValues,
): Promise<CallGroupWithMembers> =>
  http.post<CallGroupWithMembers>("/telephony/call-groups", body);

export const updateCallGroup = (
  id: string,
  body: UpdateCallGroupValues,
): Promise<CallGroupWithMembers> =>
  http.put<CallGroupWithMembers>(`/telephony/call-groups/${id}`, body);

/**
 * The whole membership goes in one write — add, remove and reorder together;
 * the devices too when sent (omitted, the server keeps the ones it has).
 */
export const setCallGroupMembers = (
  id: string,
  members: Array<Pick<CallGroupMember, "userId" | "channel"> & { order?: number; enabled?: boolean }>,
  deviceMembers?: CallGroupDeviceMemberValues[],
): Promise<CallGroupWithMembers> =>
  http.put<CallGroupWithMembers>(`/telephony/call-groups/${id}/members`, {
    members,
    ...(deviceMembers !== undefined && { deviceMembers }),
  });

export const deleteCallGroup = (
  id: string,
): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`/telephony/call-groups/${id}`);
