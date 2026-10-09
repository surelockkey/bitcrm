import { describe, expect, it } from "vitest";
import { InventoryStatus } from "@bitcrm/types";
import type { ItemAttribute } from "@bitcrm/types";
import { ITEMS_FILTERS_DEFAULT, customFieldColumns, itemsFilter, wzAmount } from "./items-view";

/**
 * Workiz's Inventory tab (pg_inventory_wz_01_inventory): three boxes over the
 * grid — All brands, All categories, All Stock Levels — and BitCRM's status
 * box beside them; the grid prints amounts as "125.00" and ends in one
 * column per item custom field.
 */
describe("itemsFilter", () => {
  it("opens on every active stock-managed item", () => {
    expect(itemsFilter(ITEMS_FILTERS_DEFAULT, "")).toEqual({ manageStock: true, status: InventoryStatus.ACTIVE });
  });

  it("hands each picked box to the server, the search trimmed", () => {
    expect(
      itemsFilter({ brand: "b1", category: "Door Hardware", stock: "low", status: InventoryStatus.ARCHIVED }, " lock "),
    ).toEqual({
      manageStock: true,
      brandId: "b1",
      category: "Door Hardware",
      stockLevel: "low",
      status: InventoryStatus.ARCHIVED,
      search: "lock",
    });
  });

  it("leaves a box on its All out", () => {
    expect(itemsFilter({ brand: "all", category: "all", stock: "all", status: "all" }, "")).toEqual({ manageStock: true });
  });
});

describe("wzAmount", () => {
  it("prints Workiz's amounts and quantities: two decimals, no sign, no grouping", () => {
    expect(wzAmount(125)).toBe("125.00");
    expect(wzAmount(20.159)).toBe("20.16");
    expect(wzAmount(36674)).toBe("36674.00");
    expect(wzAmount(undefined)).toBe("0.00");
  });
});

describe("customFieldColumns", () => {
  const attr = (name: string, over: Partial<ItemAttribute> & { orphan?: boolean } = {}) =>
    ({ id: name, name, type: "text", resource: "items", visible: false, ...over }) as ItemAttribute;

  it("lists the item fields in the catalog's order, leaving out the import's orphans", () => {
    expect(
      customFieldColumns([
        attr("workiz_attr_190", { orphan: true }),
        attr("ALL SKU"),
        attr("In Store Location"),
        attr("Link_UHS"),
      ]),
    ).toEqual(["ALL SKU", "In Store Location", "Link_UHS"]);
  });

  it("is empty without a catalog", () => {
    expect(customFieldColumns(undefined)).toEqual([]);
  });
});
