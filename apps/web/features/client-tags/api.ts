import type { ClientTag } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** Deal-service catalog lives under the deals gateway route. */
const BASE = "/deals/client-tags";

export const listClientTags = (): Promise<ClientTag[]> => http.get<ClientTag[]>(BASE);

export const getClientTag = (id: string): Promise<ClientTag> =>
  http.get<ClientTag>(`${BASE}/${id}`);

export const createClientTag = (body: unknown): Promise<ClientTag> =>
  http.post<ClientTag>(BASE, body);

export const updateClientTag = (id: string, body: unknown): Promise<ClientTag> =>
  http.put<ClientTag>(`${BASE}/${id}`, body);

export const deleteClientTag = (
  id: string,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete<{ id: string; archived: boolean; deleted: boolean }>(`${BASE}/${id}`);
