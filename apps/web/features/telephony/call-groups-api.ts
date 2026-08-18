import { http } from "@/lib/api/http";
import type {
  CallGroupChannel,
  CallGroupMember,
  CallGroupType,
  CallGroupWithMembers,
} from "@bitcrm/types";

export type { CallGroupWithMembers, CallGroupChannel, CallGroupType };

export interface CreateCallGroupValues {
  name: string;
  description?: string;
  type?: CallGroupType;
  members?: Array<Pick<CallGroupMember, "userId" | "channel">>;
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

/** The whole membership goes in one write — add, remove and reorder together. */
export const setCallGroupMembers = (
  id: string,
  members: Array<Pick<CallGroupMember, "userId" | "channel"> & { order?: number; enabled?: boolean }>,
): Promise<CallGroupWithMembers> =>
  http.put<CallGroupWithMembers>(`/telephony/call-groups/${id}/members`, {
    members,
  });

export const deleteCallGroup = (
  id: string,
): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`/telephony/call-groups/${id}`);
