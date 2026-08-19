import { http } from "@/lib/api/http";
import type { CallFlow } from "@bitcrm/types";

export type { CallFlow };

/**
 * The three answers that cover almost every line. The step graph is built
 * server-side from these, so a flow can't be saved malformed; the step editor
 * lands in P2 over the same storage.
 */
export interface SimpleFlowValues {
  name: string;
  numbers?: string[];
  greeting?: string;
  groupId: string;
  noAnswer?: "voicemail" | "hangup";
  voicemailPrompt?: string;
  voicemailSeconds?: number;
  active?: boolean;
}

const BASE = "/telephony/call-flows";

export const listCallFlows = (): Promise<CallFlow[]> => http.get<CallFlow[]>(BASE);

export const createSimpleFlow = (body: SimpleFlowValues): Promise<CallFlow> =>
  http.post<CallFlow>(`${BASE}/simple`, body);

export const updateSimpleFlow = (
  id: string,
  body: SimpleFlowValues,
): Promise<CallFlow> => http.put<CallFlow>(`${BASE}/${id}/simple`, body);

export const deleteCallFlow = (
  id: string,
): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`${BASE}/${id}`);
