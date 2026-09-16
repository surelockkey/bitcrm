import type { CallTag, JobTagColor } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** The call-tag catalog lives in telephony, beside call groups and flows. */
const BASE = "/telephony/call-tags";

export interface CallTagValues {
  name: string;
  color?: JobTagColor;
  priority?: number;
  active?: boolean;
}

/**
 * The whole catalog in one request — tens of rows, read by every chip in the
 * call log. `GET /call-tags/:id` exists on the server but has no caller here:
 * nothing in the UI wants a single tag it cannot already find in this list.
 */
export const listCallTags = (): Promise<CallTag[]> => http.get<CallTag[]>(BASE);

export const createCallTag = (body: CallTagValues): Promise<CallTag> =>
  http.post<CallTag>(BASE, body);

export const updateCallTag = (
  id: string,
  body: Partial<CallTagValues>,
): Promise<CallTag> => http.put<CallTag>(`${BASE}/${id}`, body);

/**
 * Always an archive, never a delete — 1.8M calls keep their `tagIds` and the
 * label has to keep resolving on every historical row. Restore with
 * `updateCallTag(id, { active: true })`.
 */
export const archiveCallTag = (
  id: string,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete<{ id: string; archived: boolean; deleted: boolean }>(
    `${BASE}/${id}`,
  );
