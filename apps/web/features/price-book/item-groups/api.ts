import type { ItemGroup, ItemGroupStatus } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/**
 * Item groups (Workiz's Price book → Item groups): sets of price-book items a
 * job or an estimate takes in one go. `products.view` reads them,
 * `products.create` makes one, `products.edit` changes, disables
 * (`active: false`) or enables one. There is no delete — a job line keeps
 * naming its group.
 */

/** One line of a group as the popup sends it. `cost` is read only from a caller with `financials.view`. */
export interface ItemGroupMemberBody {
  productId: string;
  quantity: number;
  priceClient: number;
  cost?: number;
  taxable?: boolean;
  name?: string;
  description?: string;
  customAttributes?: Record<string, string>;
}

/** Workiz's "Create item group". `categoryId: ""` takes the group out of its category. */
export interface ItemGroupBody {
  name: string;
  description?: string;
  categoryId?: string;
  active?: boolean;
  members: ItemGroupMemberBody[];
}

export type ItemGroupUpdateBody = Partial<ItemGroupBody>;

/** By name; `status` is Workiz's box (the server's default: all). */
export function listItemGroups(status?: ItemGroupStatus): Promise<ItemGroup[]> {
  return http.get<ItemGroup[]>(`/inventory/item-groups${status ? `?status=${status}` : ""}`);
}

export function createItemGroup(body: ItemGroupBody): Promise<ItemGroup> {
  return http.post<ItemGroup>("/inventory/item-groups", body);
}

export function updateItemGroup(id: string, body: ItemGroupUpdateBody): Promise<ItemGroup> {
  return http.patch<ItemGroup>(`/inventory/item-groups/${encodeURIComponent(id)}`, body);
}
