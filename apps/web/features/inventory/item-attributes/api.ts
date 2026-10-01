import type { ItemAttribute, ItemAttributeType } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/** What a rename or delete did to the items that held a value. */
export interface ItemAttributeProductsResult {
  productsUpdated: number;
  productsSkipped: number;
}

export interface ItemAttributeBody {
  name: string;
  type: ItemAttributeType;
  visible: boolean;
}

/** The item custom fields, in Workiz order. */
export function listItemAttributes(): Promise<ItemAttribute[]> {
  return http.get<ItemAttribute[]>("/inventory/item-attributes");
}

export function createItemAttribute(body: ItemAttributeBody): Promise<ItemAttribute> {
  return http.post<ItemAttribute>("/inventory/item-attributes", body);
}

/** A rename moves the value on every item that has one (server side). */
export function updateItemAttribute(
  id: string,
  body: Partial<ItemAttributeBody>,
): Promise<ItemAttribute & ItemAttributeProductsResult> {
  return http.patch<ItemAttribute & ItemAttributeProductsResult>(
    `/inventory/item-attributes/${id}`,
    body,
  );
}

/** Removes the field and its value from every item. */
export function deleteItemAttribute(
  id: string,
): Promise<{ id: string; deleted: true } & ItemAttributeProductsResult> {
  return http.delete<{ id: string; deleted: true } & ItemAttributeProductsResult>(
    `/inventory/item-attributes/${id}`,
  );
}
