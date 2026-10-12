import { describe, expect, it } from "vitest";
import { InventoryStatus, ProductType, type ItemGroup, type Product, type ProductCategory } from "@bitcrm/types";
import {
  changedGroupBody,
  draftLineFromProduct,
  draftLinesFromGroup,
  draftTotal,
  filterItemGroups,
  groupBodyFromDraft,
  groupEstimateLines,
  groupTypeLabel,
  itemGroupRows,
  itemGroupsToCsv,
  lineAmount,
  lineMargin,
  pickableGroups,
  validateGroupDraft,
} from "./lib";

const group = (over: Partial<ItemGroup> = {}): ItemGroup => ({
  id: "g-1",
  name: "Storm Door 36\" x 80\"",
  description: "",
  groupType: "separate_items",
  active: true,
  total: 707.9,
  members: [
    { productId: "p-svc", name: "Service Call & On-Site Assessment", quantity: 1, priceClient: 45, taxable: true, description: "Trip", customAttributes: {}, cost: 0 },
    { productId: "p-door", name: "36 in. x 80 in. White Vinyl Storm Door", quantity: 1, priceClient: 288.9, taxable: true, description: "", customAttributes: { "In Store Location": "8-B-8" }, cost: 160 },
    { productId: "p-labor", name: "Storm Door Installation Labor", quantity: 1, priceClient: 374, taxable: true, description: "", customAttributes: {}, cost: 0 },
  ],
  ...over,
});

const category = (over: Partial<ProductCategory>): ProductCategory =>
  ({ id: "c", name: "Doors", active: true, createdAt: "", updatedAt: "", ...over }) as ProductCategory;

const product = (over: Partial<Product>): Product =>
  ({
    id: "p",
    sku: "WZ-1",
    name: "Item",
    category: "Doors",
    type: ProductType.PRODUCT,
    costCompany: 0,
    costTech: 0,
    priceClient: 0,
    serialTracking: false,
    minimumStockLevel: 0,
    status: InventoryStatus.ACTIVE,
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as Product;

describe("groupTypeLabel", () => {
  it("prints Workiz's two types in its words, Individual items for anything else", () => {
    expect(groupTypeLabel("separate_items")).toBe("Individual items");
    expect(groupTypeLabel("flat_rate")).toBe("Flat rate");
    expect(groupTypeLabel(undefined)).toBe("Individual items");
  });
});

describe("itemGroupRows", () => {
  it("makes Workiz's columns: the item names, the type, the total and the category's own name", () => {
    const rows = itemGroupRows(
      [group({ categoryId: "c-2" })],
      [category({ id: "c-1", name: "Doors" }), category({ id: "c-2", name: "Doors > Storm doors" })],
    );

    expect(rows).toEqual([
      expect.objectContaining({
        id: "g-1",
        name: "Storm Door 36\" x 80\"",
        items: "Service Call & On-Site Assessment, 36 in. x 80 in. White Vinyl Storm Door, Storm Door Installation Labor",
        groupType: "Individual items",
        total: 707.9,
        category: "Storm doors",
        active: true,
      }),
    ]);
  });

  it("leaves the category blank when the group has none or it is gone", () => {
    const rows = itemGroupRows([group(), group({ id: "g-2", categoryId: "gone" })], []);
    expect(rows.map((r) => r.category)).toEqual(["", ""]);
  });
});

describe("filterItemGroups", () => {
  const rows = itemGroupRows(
    [group(), group({ id: "g-2", name: "Metal Door", active: false, description: "Rear" })],
    [],
  );

  it("keeps the status box's groups: Active, Disabled or All", () => {
    expect(filterItemGroups(rows, "active", "").map((r) => r.id)).toEqual(["g-1"]);
    expect(filterItemGroups(rows, "disabled", "").map((r) => r.id)).toEqual(["g-2"]);
    expect(filterItemGroups(rows, "all", "").map((r) => r.id)).toEqual(["g-1", "g-2"]);
  });

  it("searches the name, the description and the item names, any case", () => {
    expect(filterItemGroups(rows, "all", "metal").map((r) => r.id)).toEqual(["g-2"]);
    expect(filterItemGroups(rows, "all", "REAR").map((r) => r.id)).toEqual(["g-2"]);
    expect(filterItemGroups(rows, "all", "vinyl").map((r) => r.id)).toEqual(["g-1", "g-2"]);
  });
});

describe("itemGroupsToCsv", () => {
  it("writes the rows on show in the grid's columns, quoting what needs it", () => {
    const csv = itemGroupsToCsv(itemGroupRows([group({ description: 'Door, "white"' })], []));

    expect(csv.split("\n")).toEqual([
      "Name,Description,Items,Group type,Total,Category",
      '"Storm Door 36"" x 80""","Door, ""white""","Service Call & On-Site Assessment, 36 in. x 80 in. White Vinyl Storm Door, Storm Door Installation Labor",Individual items,707.90,',
    ]);
  });
});

describe("the editor's lines", () => {
  it("opens a group's members as editable lines, cost blank when the caller may not see it", () => {
    const lines = draftLinesFromGroup(group({ members: [{ ...group().members[1], cost: undefined }] }));

    expect(lines).toEqual([
      expect.objectContaining({
        productId: "p-door",
        name: "36 in. x 80 in. White Vinyl Storm Door",
        quantity: "1",
        price: "288.9",
        cost: "",
        taxable: true,
        description: "",
        customAttributes: { "In Store Location": "8-B-8" },
      }),
    ]);
    expect(lines[0].key).toEqual(expect.any(String));
  });

  it("adds an item from the price book at its price and company cost, one of it", () => {
    const line = draftLineFromProduct(
      product({ id: "p-x", name: "Kwikset Deadbolt", type: ProductType.SERVICE, priceClient: 45, costCompany: 15 }),
    );

    expect(line).toMatchObject({ productId: "p-x", name: "Kwikset Deadbolt", type: "service", quantity: "1", price: "45", cost: "15" });
    expect(draftLineFromProduct(product({ costCompany: undefined as unknown as number })).cost).toBe("");
  });

  it("works out Workiz's Amount and Margin, and the Total in cents", () => {
    const door = { ...draftLinesFromGroup(group())[1] };
    expect(lineAmount(door)).toBe(288.9);
    expect(lineAmount({ ...door, quantity: "1.5", price: "250" })).toBe(375);
    expect(lineAmount({ ...door, quantity: "x" })).toBe(0);

    expect(lineMargin({ ...door, price: "379.95", cost: "227.4" })).toBe("40.15%");
    expect(lineMargin({ ...door, price: "250", cost: "0" })).toBe("100.00%");
    expect(lineMargin({ ...door, price: "0", cost: "5" })).toBe("");
    expect(lineMargin({ ...door, cost: "" })).toBe("");

    expect(draftTotal([{ ...door, quantity: "3", price: "0.1" }])).toBe(0.3);
    expect(draftTotal(draftLinesFromGroup(group()))).toBe(707.9);
  });
});

describe("validateGroupDraft", () => {
  const lines = draftLinesFromGroup(group());

  it("passes a named group with items", () => {
    expect(validateGroupDraft({ name: "Storm door", lines })).toBeNull();
  });

  it("asks for a name and at least one item", () => {
    expect(validateGroupDraft({ name: "  ", lines: [] })).toEqual({
      name: "Name is required",
      items: "Add at least one item",
      lines: {},
    });
  });

  it("names the line whose quantity, price or cost is not a number it can take", () => {
    const bad = [{ ...lines[0], quantity: "0" }, { ...lines[1], price: "-1" }, { ...lines[2], cost: "abc" }];

    expect(validateGroupDraft({ name: "x", lines: bad })).toEqual({
      lines: {
        [bad[0].key]: { quantity: "More than 0" },
        [bad[1].key]: { price: "0 or more" },
        [bad[2].key]: { cost: "0 or more" },
      },
    });
  });
});

describe("groupBodyFromDraft", () => {
  const lines = draftLinesFromGroup(group());

  it("sends the trimmed name, description, category and every line's numbers and words", () => {
    const body = groupBodyFromDraft({ name: " Storm door ", description: " Door ", categoryId: "c-1", lines }, { canSeeCost: true });

    expect(body).toEqual({
      name: "Storm door",
      description: "Door",
      categoryId: "c-1",
      members: [
        { productId: "p-svc", name: "Service Call & On-Site Assessment", quantity: 1, priceClient: 45, cost: 0, taxable: true, description: "Trip", customAttributes: {} },
        { productId: "p-door", name: "36 in. x 80 in. White Vinyl Storm Door", quantity: 1, priceClient: 288.9, cost: 160, taxable: true, description: "", customAttributes: { "In Store Location": "8-B-8" } },
        { productId: "p-labor", name: "Storm Door Installation Labor", quantity: 1, priceClient: 374, cost: 0, taxable: true, description: "", customAttributes: {} },
      ],
    });
  });

  it("sends no cost for a caller who may not see money, and no category when none is chosen", () => {
    const body = groupBodyFromDraft({ name: "x", description: "", categoryId: "", lines }, { canSeeCost: false });

    expect(body.members.every((m) => !("cost" in m))).toBe(true);
    expect(body.categoryId).toBe("");
  });
});

describe("changedGroupBody", () => {
  const g = group({ categoryId: "c-1", description: "Door" });
  const same = groupBodyFromDraft(
    { name: g.name, description: "Door", categoryId: "c-1", lines: draftLinesFromGroup(g) },
    { canSeeCost: true },
  );

  it("sends nothing for an unchanged group", () => {
    expect(changedGroupBody(g, same)).toEqual({});
  });

  it("sends only what changed — the whole member list when any line did", () => {
    const body = { ...same, name: "Storm door", categoryId: "", members: same.members.slice(1) };

    expect(changedGroupBody(g, body)).toEqual({ name: "Storm door", categoryId: "", members: same.members.slice(1) });
  });

  it("treats a cost the caller cannot see as unchanged", () => {
    const blind = groupBodyFromDraft(
      { name: g.name, description: "Door", categoryId: "c-1", lines: draftLinesFromGroup(g) },
      { canSeeCost: false },
    );
    expect(changedGroupBody(g, blind)).toEqual({});
  });
});

describe("pickableGroups", () => {
  const groups = [
    group({ id: "a", name: "Commercial door" }),
    group({ id: "b", name: "Metal Door", active: false }),
    group({ id: "c", name: "Spring adjustment", members: [{ ...group().members[0], name: "Labor for Spring Adjustment" }] }),
    group({ id: "d", name: "Flat", groupType: "flat_rate" }),
  ];

  it("offers the active Individual items groups whose name or items match, by name", () => {
    expect(pickableGroups(groups, "").map((g) => g.id)).toEqual(["a", "c"]);
    expect(pickableGroups(groups, "door").map((g) => g.id)).toEqual(["a"]);
    expect(pickableGroups(groups, "SPRING").map((g) => g.id)).toEqual(["c"]);
    expect(pickableGroups(undefined, "x")).toEqual([]);
  });
});

describe("groupEstimateLines", () => {
  it("turns the members into estimate lines: the group's numbers and words, the price book's SKU, type and costs", () => {
    const catalog = new Map([
      ["p-svc", product({ id: "p-svc", sku: "WZ-15553", type: ProductType.SERVICE, costCompany: 0, costTech: 0 })],
      ["p-door", product({ id: "p-door", sku: "WZ-10897", costCompany: 150, costTech: 170 })],
    ]);

    expect(groupEstimateLines(group(), catalog)).toEqual([
      { productId: "p-svc", productType: ProductType.SERVICE, name: "Service Call & On-Site Assessment", sku: "WZ-15553", description: "Trip", quantity: 1, priceClient: 45, costCompany: 0, costForTech: 0, taxable: true },
      { productId: "p-door", productType: ProductType.PRODUCT, name: "36 in. x 80 in. White Vinyl Storm Door", sku: "WZ-10897", quantity: 1, priceClient: 288.9, costCompany: 150, costForTech: 170, taxable: true },
      // Not in the catalog the picker holds: the line still goes, at no cost.
      { productId: "p-labor", name: "Storm Door Installation Labor", sku: "", quantity: 1, priceClient: 374, costCompany: 0, costForTech: 0, taxable: true },
    ]);
  });
});
