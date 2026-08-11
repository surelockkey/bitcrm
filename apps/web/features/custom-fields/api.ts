import type { CustomFieldDefinition } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** Custom-field catalog lives under the deals gateway route. */
const BASE = "/deals/custom-fields";

export const listCustomFields = (): Promise<CustomFieldDefinition[]> =>
  http.get<CustomFieldDefinition[]>(BASE);

export const getCustomField = (id: string): Promise<CustomFieldDefinition> =>
  http.get<CustomFieldDefinition>(`${BASE}/${id}`);

export const createCustomField = (
  body: unknown,
): Promise<CustomFieldDefinition> =>
  http.post<CustomFieldDefinition>(BASE, body);

export const updateCustomField = (
  id: string,
  body: unknown,
): Promise<CustomFieldDefinition> =>
  http.put<CustomFieldDefinition>(`${BASE}/${id}`, body);

export const removeCustomField = (
  id: string,
): Promise<{ id: string; archived: boolean; deleted: boolean }> =>
  http.delete<{ id: string; archived: boolean; deleted: boolean }>(
    `${BASE}/${id}`,
  );
