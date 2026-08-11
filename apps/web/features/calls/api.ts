import { apiFetchPaginated, http } from "@/lib/api/http";
import type { PaginatedResponse } from "@bitcrm/types";
import { env } from "@/lib/env";
import { getIdToken } from "@/stores/auth-store";
import { filterToParams, type CallRecord, type CallsFilter } from "./lib";

const BASE = "/telephony/calls";

export function listCalls(
  filter: CallsFilter,
  cursor?: string,
): Promise<PaginatedResponse<CallRecord>> {
  const qs = filterToParams(filter, cursor, 25);
  return apiFetchPaginated<CallRecord>(`${BASE}?${qs.toString()}`);
}

export const getCall = (sid: string): Promise<CallRecord> =>
  http.get<CallRecord>(`${BASE}/${sid}`);

export const getLiveCalls = (): Promise<CallRecord[]> =>
  http.get<CallRecord[]>(`${BASE}/live`);

/** Ask for a listen/join grant; returns the conference to connect to. */
export const requestMonitor = (
  sid: string,
  mode: "listen" | "join",
): Promise<{ conferenceName: string }> =>
  http.post<{ conferenceName: string }>(`${BASE}/${sid}/monitor`, { mode });

/** The SSE stream path (opened with fetch so the Bearer header can be sent). */
export const CALLS_STREAM_PATH = `${BASE}/stream`;

/**
 * Recording audio. `<audio src>` can't carry the Bearer header, so the media
 * is fetched as a blob (authorized) and played through an object URL.
 */
export async function fetchRecordingBlob(sid: string): Promise<Blob> {
  const res = await fetch(`${env.apiBaseUrl}${BASE}/${sid}/recording`, {
    headers: { Authorization: `Bearer ${getIdToken() ?? ""}` },
  });
  if (!res.ok) throw new Error(`Recording unavailable (${res.status})`);
  return res.blob();
}
