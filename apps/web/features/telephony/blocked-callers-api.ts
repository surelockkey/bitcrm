import { http } from "@/lib/api/http";
import { BLOCKED_CALLER_LIMITS, type BlockedCaller } from "@bitcrm/types";

export type { BlockedCaller };

/** `POST /telephony/blocked-callers` — the number in any dialable form, an optional comment. */
export interface BlockCallerValues {
  number: string;
  comment?: string;
}

export interface ListBlockedCallersParams {
  /** Digits of a number or words of a comment. */
  q?: string;
  page?: number;
  limit?: number;
}

/**
 * The block list, oldest first. One request for the whole list by default
 * (the server's cap, 1000 — the account has 930): the grid searches, sorts
 * and pages on the client, as Workiz's react-table does.
 */
export const listBlockedCallers = async (params: ListBlockedCallersParams = {}): Promise<BlockedCaller[]> => {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  search.set("page", String(params.page ?? 1));
  search.set("limit", String(params.limit ?? BLOCKED_CALLER_LIMITS.listMaxLimit));
  const page = await http.getPaginated<BlockedCaller>(`/telephony/blocked-callers?${search.toString()}`);
  return page.data;
};

export const blockCaller = (body: BlockCallerValues): Promise<BlockedCaller> =>
  http.post<BlockedCaller>("/telephony/blocked-callers", body);

/** `DELETE /telephony/blocked-callers/:number` — the E.164 goes URL-encoded (`%2B1…`). */
export const unblockCaller = (number: string): Promise<{ number: string; deleted: true }> =>
  http.delete<{ number: string; deleted: true }>(`/telephony/blocked-callers/${encodeURIComponent(number)}`);
