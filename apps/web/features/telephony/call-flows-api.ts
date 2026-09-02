import { http } from "@/lib/api/http";
import type { CallFlow, CallFlowAudio, CallFlowNode } from "@bitcrm/types";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";

export type { CallFlow, CallFlowAudio };

/** The full step graph — what the editor saves. */
export interface CallFlowValues {
  name: string;
  description?: string;
  numbers?: string[];
  entryNodeId?: string;
  nodes?: Record<string, CallFlowNode>;
  active?: boolean;
}

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

export const createCallFlow = (body: CallFlowValues): Promise<CallFlow> =>
  http.post<CallFlow>(BASE, body);

export const updateCallFlow = (
  id: string,
  body: CallFlowValues,
): Promise<CallFlow> => http.put<CallFlow>(`${BASE}/${id}`, body);

/**
 * Uploaded greetings go up as multipart, which the JSON client can't express —
 * so this is the one call that builds its own request.
 */
export async function uploadFlowAudio(file: File): Promise<CallFlowAudio> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`${env.apiBaseUrl}${BASE}/audio`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getIdToken() ?? ""}` },
    body: form,
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    throw new Error(body?.error?.message ?? body?.message ?? "Upload failed");
  }
  return body.data as CallFlowAudio;
}

export const deleteCallFlow = (
  id: string,
): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`${BASE}/${id}`);
