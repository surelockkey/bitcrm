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

export const listCallTags = (): Promise<CallTag[]> => http.get<CallTag[]>(BASE);

export const getCallTag = (id: string): Promise<CallTag> =>
  http.get<CallTag>(`${BASE}/${id}`);

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
