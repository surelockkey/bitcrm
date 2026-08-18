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

/**
 * Calls with one client, company or teammate — an indexed lookup rather than
 * a filtered scan of the whole log.
 */
export function listCallsByParty(
  kind: "contact" | "company" | "user",
  id: string,
  cursor?: string,
): Promise<PaginatedResponse<CallRecord>> {
  const qs = new URLSearchParams({ limit: "25" });
  if (cursor) qs.set("cursor", cursor);
  return apiFetchPaginated<CallRecord>(
    `${BASE}/by-party/${kind}/${id}?${qs.toString()}`,
  );
}

export const getCall = (sid: string): Promise<CallRecord> =>
  http.get<CallRecord>(`${BASE}/${sid}`);

/**
 * The call the signed-in user is on right now, or null. The browser knows its
 * own Twilio leg, but on an inbound call that leg is a child of the record —
 * so the server answers this, not the SDK.
 */
export const getActiveCall = (): Promise<CallRecord | null> =>
  http.get<CallRecord | null>(`${BASE}/active`);

export const getLiveCalls = (): Promise<CallRecord[]> =>
  http.get<CallRecord[]>(`${BASE}/live`);

/** Ask for a listen/join grant; returns the conference to connect to. */
/** Attach this call to a job, or detach it with null. */
export const setCallDeal = (
  sid: string,
  dealId: string | null,
): Promise<CallRecord> =>
  http.put<CallRecord>(`${BASE}/${sid}/deal`, { dealId });

/** Correct who a call was with; marks the record as set by a person. */
export const setCallParty = (
  sid: string,
  body: {
    side: "from" | "to";
    kind: "user" | "contact" | "company" | null;
    id: string;
  },
): Promise<CallRecord> => http.put<CallRecord>(`${BASE}/${sid}/party`, body);

export const requestMonitor = (
  sid: string,
  mode: "listen" | "join",
): Promise<{ conferenceName: string }> =>
  http.post<{ conferenceName: string }>(`${BASE}/${sid}/monitor`, { mode });

/**
 * Move the call you're on into this tab. Two steps on purpose: only the
 * browser knows when its new leg is actually in the conference, and dropping
 * the old one before that would put the customer on hold music.
 */
export const requestTakeCall = (
  sid: string,
): Promise<{ conferenceName: string; previousLegs: string[] }> =>
  http.post<{ conferenceName: string; previousLegs: string[] }>(
    `${BASE}/${sid}/take`,
    {},
  );

export const completeTakeCall = (
  sid: string,
  previousLegs: string[],
): Promise<{ sid: string; movedTo: string[] }> =>
  http.post<{ sid: string; movedTo: string[] }>(`${BASE}/${sid}/take/complete`, {
    previousLegs,
  });

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
