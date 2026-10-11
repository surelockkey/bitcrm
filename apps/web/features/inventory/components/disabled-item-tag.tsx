import { InventoryStatus, type Product } from "@bitcrm/types";

/**
 * Ours, beside an item's name in the Inventory and Price Book grids: a
 * switched-off (archived) item says so. With the status filter on All the
 * grids hold both kinds, and the old Status column that told them apart went
 * in the Workiz pass. Drawn as Workiz's `Tag` (the stock popup's "Low stock"
 * shape: 4px corners, 4px in, 14px/16px white) in its grey, and inline, so
 * the fixed rows keep their height. Workiz's own word for them is
 * "Disabled items".
 */
export function DisabledItemTag() {
  return (
    <span
      data-slot="disabled-item-tag"
      className="inline-flex shrink-0 rounded-[4px] bg-wz-outline px-1 text-sm leading-4 font-normal text-white"
    >
      Disabled
    </span>
  );
}

export const isDisabledItem = (p: Pick<Product, "status">): boolean => p.status === InventoryStatus.ARCHIVED;
