import { describe, it, expect } from "vitest";
import { InventoryStatus, type Brand, type ProductCategoryWithCounts } from "@bitcrm/types";
import { searchBrands, searchCategories, buildCategoryTree, parentOptions } from "./lib";

const brand = (over: Partial<Brand>): Brand => ({
  id: "b-1",
  name: "Kwikset",
  status: InventoryStatus.ACTIVE,
  createdAt: "",
  updatedAt: "",
  ...over,
});

const cat = (over: Partial<ProductCategoryWithCounts>): ProductCategoryWithCounts => ({
  id: "c-1",
  name: "Locks",
  status: InventoryStatus.ACTIVE,
  activeItemCount: 0,
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("searchBrands", () => {
  const brands = [
    brand({ id: "b-1", name: "Kwikset", description: "Residential locks" }),
    brand({ id: "b-2", name: "Schlage" }),
  ];

  it("returns everything when the query is blank", () => {
    expect(searchBrands(brands, "   ")).toHaveLength(2);
  });

  it("matches name and description case-insensitively", () => {
    expect(searchBrands(brands, "kwik").map((b) => b.id)).toEqual(["b-1"]);
    expect(searchBrands(brands, "RESIDENTIAL").map((b) => b.id)).toEqual(["b-1"]);
  });

  it("survives an undefined list while the query is still loading", () => {
    expect(searchBrands(undefined, "kwik")).toEqual([]);
  });
});

describe("searchCategories", () => {
  const rows = [
    cat({ id: "c-1", name: "Locks" }),
    cat({ id: "c-2", name: "Deadbolts", parentId: "c-1", parentName: "Locks" }),
    cat({ id: "c-3", name: "Key blanks", description: "Uncut keys" }),
  ];

  it("matches the parent name so a child is findable by its family", () => {
    expect(searchCategories(rows, "locks").map((c) => c.id)).toEqual(["c-1", "c-2"]);
  });

  it("matches the description", () => {
    expect(searchCategories(rows, "uncut").map((c) => c.id)).toEqual(["c-3"]);
  });
});

describe("buildCategoryTree", () => {
  it("nests children under their parent and stamps a depth for indentation", () => {
    const rows = [
      cat({ id: "c-3", name: "Grade 1", parentId: "c-2" }),
      cat({ id: "c-2", name: "Deadbolts", parentId: "c-1" }),
      cat({ id: "c-1", name: "Locks" }),
    ];

    expect(buildCategoryTree(rows).map((r) => [r.name, r.depth])).toEqual([
      ["Locks", 0],
      ["Deadbolts", 1],
      ["Grade 1", 2],
    ]);
  });

  it("sorts alphabetically within each level, not across the whole list", () => {
    const rows = [
      cat({ id: "c-1", name: "Locks" }),
      cat({ id: "c-2", name: "Zebra", parentId: "c-1" }),
      cat({ id: "c-3", name: "Alarms" }),
      cat({ id: "c-4", name: "Anchors", parentId: "c-1" }),
    ];

    expect(buildCategoryTree(rows).map((r) => r.name)).toEqual([
      "Alarms",
      "Locks",
      "Anchors",
      "Zebra",
    ]);
  });

  it("floats a category to the root when its parent is not in the list", () => {
    // Happens whenever a search filters the parent out — the child must still
    // render, or a matching row silently disappears.
    const rows = [cat({ id: "c-2", name: "Deadbolts", parentId: "c-1", parentName: "Locks" })];

    expect(buildCategoryTree(rows).map((r) => [r.name, r.depth])).toEqual([["Deadbolts", 0]]);
  });

  it("does not hang on a parent cycle", () => {
    const rows = [
      cat({ id: "c-1", name: "A", parentId: "c-2" }),
      cat({ id: "c-2", name: "B", parentId: "c-1" }),
    ];

    expect(buildCategoryTree(rows)).toHaveLength(2);
  });
});

describe("parentOptions", () => {
  const rows = [
    cat({ id: "c-1", name: "Locks" }),
    cat({ id: "c-2", name: "Deadbolts", parentId: "c-1" }),
    cat({ id: "c-3", name: "Grade 1", parentId: "c-2" }),
    cat({ id: "c-4", name: "Retired", status: InventoryStatus.ARCHIVED }),
  ];

  it("offers every active category when creating a new one", () => {
    expect(parentOptions(rows).map((c) => c.id)).toEqual(["c-1", "c-2", "c-3"]);
  });

  it("excludes the category itself and every descendant", () => {
    // Re-parenting Locks under Grade 1 would tear the subtree off the root —
    // the backend rejects it, so the picker must not offer it.
    expect(parentOptions(rows, "c-1")).toEqual([]);
  });

  it("still offers unrelated branches when editing a leaf", () => {
    expect(parentOptions(rows, "c-3").map((c) => c.id)).toEqual(["c-1", "c-2"]);
  });
});
