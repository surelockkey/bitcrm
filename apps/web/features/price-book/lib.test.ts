import { describe, it, expect } from "vitest";
import { InventoryStatus, ProductType } from "@bitcrm/types";
import type { Brand, Product } from "@bitcrm/types";
import {
  SHOW_DEFAULT,
  brandNameMap,
  bookingLabel,
  catalogRows,
  catalogsToCsv,
  categoryLeaf,
  filterCatalog,
  inventoryLabel,
  itemTypeLabel,
  leafCategoryName,
  normalizeShow,
  showGroups,
  taxableLabel,
  toProductFilter,
  withParentPath,
  type CatalogEntry,
} from "./lib";

function product(over: Partial<Product> = {}): Product {
  return {
    id: "p1",
    sku: "S",
    name: "N",
    category: "Locks",
    type: ProductType.PRODUCT,
    costCompany: 1,
    costTech: 1,
    priceClient: 1,
    serialTracking: false,
    minimumStockLevel: 0,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

const entry = (id: string, name: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id,
  name,
  active: true,
  createdBy: "",
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("toProductFilter — Workiz's Show box as the server reads it", () => {
  it("starts on active items of every type — Workiz's one chip, status: Active items", () => {
    expect(SHOW_DEFAULT).toEqual({ status: ["active"] });
    expect(toProductFilter(SHOW_DEFAULT, "")).toEqual({ status: InventoryStatus.ACTIVE });
  });

  it("sends every group at once, the search trimmed", () => {
    expect(
      toProductFilter(
        {
          type: ["service"],
          status: ["archived"],
          category: ["Locks"],
          brand: ["b1"],
          inventory: ["no"],
        },
        "  dead  ",
      ),
    ).toEqual({
      search: "dead",
      type: ProductType.SERVICE,
      category: "Locks",
      brandId: "b1",
      status: InventoryStatus.ARCHIVED,
      manageStock: false,
    });
  });

  it("reads no chips, or both values of a two-value group, as no narrowing", () => {
    expect(toProductFilter({}, "   ")).toEqual({});
    expect(
      toProductFilter({ type: ["product", "service"], status: ["active", "archived"], inventory: ["yes", "no"] }, ""),
    ).toEqual({});
  });

  it("reads inventory: Yes as manageStock=true", () => {
    expect(toProductFilter({ inventory: ["yes"] }, "").manageStock).toBe(true);
  });
});

describe("normalizeShow — one category and one brand at a time (the server reads one)", () => {
  it("keeps the newest pick of a category or a brand", () => {
    expect(normalizeShow({ category: ["Locks"] }, { category: ["Locks", "Keys"] })).toEqual({ category: ["Keys"] });
    expect(normalizeShow({ brand: ["b1"] }, { brand: ["b1", "b2"], status: ["active"] })).toEqual({
      brand: ["b2"],
      status: ["active"],
    });
  });

  it("leaves the two-value groups and removals alone", () => {
    expect(normalizeShow({ type: ["product"] }, { type: ["product", "service"] })).toEqual({
      type: ["product", "service"],
    });
    expect(normalizeShow({ category: ["Locks"] }, {})).toEqual({});
  });
});

describe("showGroups — the Show menu", () => {
  const categories = [entry("c2", "Keys"), entry("c1", "Locks"), entry("c3", "Platinum > Private"), entry("u", "Uncategorized")];
  const brands: Brand[] = [entry("b2", "UHS"), entry("b1", "SLK")];

  it("lists Workiz's groups in its order, then ours: ITEM TYPE, STATUS, CATEGORY, BRAND, INVENTORY", () => {
    const groups = showGroups({ categories, brands, canCategories: true, canBrands: true });
    expect(groups.map((g) => [g.key, g.label, g.chip])).toEqual([
      ["type", "Item type", "type"],
      ["status", "Status", "status"],
      ["category", "Category", "category"],
      ["brand", "Brand", "brand"],
      ["inventory", "Inventory", "inventory"],
    ]);
    expect(groups[0].options.map((o) => o.label)).toEqual(["Product", "Service"]);
    expect(groups[1].options).toEqual([
      { value: "active", label: "Active items" },
      { value: "archived", label: "Disabled items" },
    ]);
    expect(groups[4].options.map((o) => o.label)).toEqual(["Yes", "No"]);
  });

  it("offers each category by its own name, sorted, filed by the full name; Uncategorized last", () => {
    const [, , category] = showGroups({ categories, brands, canCategories: true, canBrands: true });
    expect(category.options).toEqual([
      { value: "Keys", label: "Keys" },
      { value: "Locks", label: "Locks" },
      { value: "Platinum > Private", label: "Private" },
      { value: "Uncategorized", label: "Uncategorized" },
    ]);
  });

  it("offers the brands by name, sorted, filed by id; a duplicate category name once", () => {
    const groups = showGroups({
      categories: [...categories, entry("u2", "Uncategorized")],
      brands,
      canCategories: true,
      canBrands: true,
    });
    expect(groups[3].options).toEqual([
      { value: "b1", label: "SLK" },
      { value: "b2", label: "UHS" },
    ]);
    expect(groups[2].options.filter((o) => o.value === "Uncategorized")).toHaveLength(1);
  });

  it("keeps Workiz's own order for imported rows (its ids), BitCRM's own after them by name", () => {
    const groups = showGroups({
      categories: [
        entry("k", "Key Codes", { externalId: "workiz:category:74295" }),
        entry("a", "Alarms"),
        entry("d", "Door Hardware", { externalId: "workiz:category:1511" }),
        entry("l", "Locks & Cylinders", { externalId: "workiz:category:1510" }),
        entry("u", "Uncategorized", { externalId: "workiz:category:uncategorized" }),
      ],
      brands: [entry("s", "SLK", { externalId: "workiz:brand:1684" }), entry("x", "Acme"), entry("h", "UHS", { externalId: "workiz:brand:1456" })],
      canCategories: true,
      canBrands: true,
    });
    expect(groups[2].options.map((o) => o.label)).toEqual(["Locks & Cylinders", "Door Hardware", "Key Codes", "Alarms", "Uncategorized"]);
    expect(groups[3].options.map((o) => o.label)).toEqual(["UHS", "SLK", "Acme"]);
  });

  it("leaves out a catalog its reader may not see", () => {
    const keys = showGroups({ categories, brands, canCategories: false, canBrands: false }).map((g) => g.key);
    expect(keys).toEqual(["type", "status", "inventory"]);
  });
});

describe("row words — what Workiz prints", () => {
  it("names the type, keeping Workiz's own word on an imported item", () => {
    expect(itemTypeLabel(product())).toBe("Product");
    expect(itemTypeLabel(product({ type: ProductType.SERVICE }))).toBe("Service");
    expect(itemTypeLabel(product({ type: ProductType.SERVICE, workizType: "hours" }))).toBe("Hours");
    expect(itemTypeLabel(product({ type: ProductType.SERVICE, workizType: "other" }))).toBe("Other");
  });

  it("says Inventory No for a service, whatever its flag, and Yes for a product unless switched off", () => {
    expect(inventoryLabel(product({ type: ProductType.SERVICE, manageStock: true }))).toBe("No");
    expect(inventoryLabel(product())).toBe("Yes");
    expect(inventoryLabel(product({ manageStock: false }))).toBe("No");
  });

  it("reads Booking off availableInBooking, absent as No", () => {
    expect(bookingLabel(product())).toBe("No");
    expect(bookingLabel(product({ availableInBooking: true }))).toBe("Yes");
  });

  it("reads an absent taxable as Yes", () => {
    expect(taxableLabel(product())).toBe("Yes");
    expect(taxableLabel(product({ taxable: false }))).toBe("No");
  });

  it("prints a category by its own name, Uncategorized as nothing", () => {
    expect(categoryLeaf("Platinum Client's > Private Platinum Clients")).toBe("Private Platinum Clients");
    expect(categoryLeaf("Locks")).toBe("Locks");
    expect(categoryLeaf("Uncategorized")).toBe("");
    expect(categoryLeaf(undefined)).toBe("");
  });

  it("maps brand ids to names, archived brands included", () => {
    const names = brandNameMap([entry("b1", "Schlage"), entry("b2", "Old", { active: false })]);
    expect(names.get("b1")).toBe("Schlage");
    expect(names.get("b2")).toBe("Old");
    expect(brandNameMap(undefined).size).toBe(0);
  });
});

describe("catalog rows — Workiz's category tree, flattened", () => {
  const categories = [
    entry("p", "Platinum Client's", { description: "Only for Platinum", workizFilePath: "https://x.test/p.png" }),
    entry("c", "Platinum Client's > Private Platinum Clients", { parentId: "p" }),
    entry("g", "Platinum Client's > Private Platinum Clients > State of CT", { parentId: "c" }),
    entry("o", "Orphan > Child"),
    entry("u", "Uncategorized"),
    entry("l", "Locks", { active: false }),
  ];

  it("names each by its own name, its parent by the parent's own name, Uncategorized left out", () => {
    const rows = catalogRows(categories);
    expect(rows.map((r) => [r.id, r.name, r.parentName])).toEqual([
      ["l", "Locks", ""],
      ["o", "Child", "Orphan"],
      ["p", "Platinum Client's", ""],
      ["c", "Private Platinum Clients", "Platinum Client's"],
      ["g", "State of CT", "Private Platinum Clients"],
    ]);
    expect(rows.find((r) => r.id === "p")).toMatchObject({
      fullName: "Platinum Client's",
      description: "Only for Platinum",
      picture: "https://x.test/p.png",
      active: true,
    });
  });

  it("knows which categories hold sub-categories", () => {
    const rows = catalogRows(categories);
    expect(rows.filter((r) => r.hasChildren).map((r) => r.id)).toEqual(["p", "c"]);
  });

  it("lists imported categories in Workiz's order, a parent before its children, BitCRM's own after", () => {
    const rows = catalogRows([
      entry("g", "P > C > G", { externalId: "workiz:category:46287", parentId: "c" }),
      entry("n", "Alarms"),
      entry("c", "P > C", { externalId: "workiz:category:39907", parentId: "p" }),
      entry("p", "P", { externalId: "workiz:category:39908" }),
      entry("l", "Locks", { externalId: "workiz:category:1510" }),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["l", "p", "c", "g", "n"]);
  });

  it("splits a full name into its parent's path and its own name", () => {
    expect(leafCategoryName("A > B > C")).toEqual({ parentPath: "A > B", name: "C" });
    expect(leafCategoryName("Locks")).toEqual({ parentPath: "", name: "Locks" });
    expect(withParentPath("A > B", "  New  ")).toBe("A > B > New");
    expect(withParentPath("", "Locks")).toBe("Locks");
  });

  it("shows Active, Disabled or All, and finds by name or description", () => {
    const rows = catalogRows(categories);
    expect(filterCatalog(rows, "active", "").map((r) => r.id)).toEqual(["o", "p", "c", "g"]);
    expect(filterCatalog(rows, "disabled", "").map((r) => r.id)).toEqual(["l"]);
    expect(filterCatalog(rows, "all", "").map((r) => r.id)).toEqual(["l", "o", "p", "c", "g"]);
    expect(filterCatalog(rows, "all", "  platinum ").map((r) => r.id)).toEqual(["p", "c"]);
  });

  it("exports the rows the reader sees as CSV, counts beside them", () => {
    const rows = catalogRows(categories).filter((r) => r.id === "p" || r.id === "c");
    const csv = catalogsToCsv(rows, new Map([["Platinum Client's", 3]]));
    expect(csv.split("\n")).toEqual([
      "Name,Description,Parent category,No. of active items",
      "Platinum Client's,Only for Platinum,,3",
      "Private Platinum Clients,,Platinum Client's,",
    ]);
  });
});
