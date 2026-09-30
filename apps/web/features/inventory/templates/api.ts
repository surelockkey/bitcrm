import type {
  ContainerTemplate,
  ContainerTemplateDiff,
  ContainerTemplateFillResult,
  InventoryStatus,
} from "@bitcrm/types";
import { http } from "@/lib/api/http";

/**
 * Container templates — a van's "ideal loadout": products and the quantity of
 * each a van should carry. Any van is compared against one and filled from a
 * warehouse in one transfer.
 */

export interface TemplateLineBody {
  productId: string;
  /** Whole units, at least 1. */
  quantity: number;
}

export interface CreateTemplateBody {
  name: string;
  description?: string;
  items: TemplateLineBody[];
}

/** Partial; `description: null` clears it, `items` replaces every line, `status: active` restores. */
export interface UpdateTemplateBody {
  name?: string;
  description?: string | null;
  items?: TemplateLineBody[];
  status?: InventoryStatus;
}

export interface FillBody {
  containerId: string;
  warehouseId: string;
  /**
   * One per fill the user means to make (a UUID): the server moves stock once
   * for it, so a double click can't fill the van twice — the repeat is a 409.
   */
  requestId: string;
  notes?: string;
}

const BASE = "/inventory/container-templates";

/** In name order; the server answers the active ones unless asked otherwise. */
export function listContainerTemplates(status?: InventoryStatus): Promise<ContainerTemplate[]> {
  return http.get<ContainerTemplate[]>(status ? `${BASE}?status=${status}` : BASE);
}

export function getContainerTemplate(id: string): Promise<ContainerTemplate> {
  return http.get<ContainerTemplate>(`${BASE}/${encodeURIComponent(id)}`);
}

export function createContainerTemplate(body: CreateTemplateBody): Promise<ContainerTemplate> {
  return http.post<ContainerTemplate>(BASE, body);
}

export function updateContainerTemplate(id: string, body: UpdateTemplateBody): Promise<ContainerTemplate> {
  return http.put<ContainerTemplate>(`${BASE}/${encodeURIComponent(id)}`, body);
}

/** Archives — never deletes: vans may still name it. */
export function archiveContainerTemplate(id: string): Promise<ContainerTemplate> {
  return http.delete<ContainerTemplate>(`${BASE}/${encodeURIComponent(id)}`);
}

/** Target / on hand / missing per line; with a warehouse also what it holds and what would move. */
export function getTemplateDiff(
  id: string,
  containerId: string,
  warehouseId?: string,
): Promise<ContainerTemplateDiff> {
  const q = new URLSearchParams({ containerId });
  if (warehouseId) q.set("warehouseId", warehouseId);
  return http.get<ContainerTemplateDiff>(`${BASE}/${encodeURIComponent(id)}/diff?${q}`);
}

/** "Fill from warehouse": one warehouse → van transfer of everything that can move. */
export function fillFromWarehouse(id: string, body: FillBody): Promise<ContainerTemplateFillResult> {
  return http.post<ContainerTemplateFillResult>(`${BASE}/${encodeURIComponent(id)}/fill`, body);
}
