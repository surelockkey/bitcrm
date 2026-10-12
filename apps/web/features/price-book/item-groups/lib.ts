import type { DealProduct, ItemGroup, ItemGroupMember, ItemGroupType, Product, ProductCategory, ProductType } from "@bitcrm/types";
import type { EstimateItemBody } from "@/features/estimates/schemas";
import { leafCategoryName, type CatalogStatus } from "../lib";
import type { ItemGroupBody, ItemGroupMemberBody, ItemGroupUpdateBody } from "./api";

/* ------------------------------------------------------------------ *
 * The Item groups tab — Workiz's grid
 * ------------------------------------------------------------------ */

const TYPE_LABEL: Record<ItemGroupType, string> = {
  separate_items: "Individual items",
  flat_rate: "Flat rate",
};

/** Workiz's "Group type" words; a group that names none is Individual items. */
export function groupTypeLabel(type: string | undefined): string {
  return TYPE_LABEL[type as ItemGroupType] ?? TYPE_LABEL.separate_items;
}

/** One row of Workiz's grid: Name | Description | Items | Group type | Total | Category. */
export interface ItemGroupRow {
  id: string;
  name: string;
  description: string;
  /** The members' names, as Workiz's `itemNames` lists them. */
  items: string;
  groupType: string;
  total: number;
  /** The category's own name (without its parents), "" for none. */
  category: string;
  active: boolean;
  group: ItemGroup;
}

export function itemGroupRows(
  groups: readonly ItemGroup[] | undefined,
  categories: readonly ProductCategory[] | undefined,
): ItemGroupRow[] {
  const byId = new Map((categories ?? []).map((c) => [c.id, c]));
  return (groups ?? []).map((g) => {
    const category = g.categoryId ? byId.get(g.categoryId) : undefined;
    return {
      id: g.id,
      name: g.name,
      description: g.description ?? "",
      items: g.members.map((m) => m.name).join(", "),
      groupType: groupTypeLabel(g.groupType),
      total: g.total,
      category: category ? leafCategoryName(category.name).name : "",
      active: g.active !== false,
      group: g,
    };
  });
}

/** The rows under the status box and the Search (name, description or an item's name; any case). */
export function filterItemGroups(rows: readonly ItemGroupRow[], status: CatalogStatus, search: string): ItemGroupRow[] {
  const term = search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (status === "all" || r.active === (status === "active")) &&
      (!term || [r.name, r.description, r.items].some((s) => s.toLowerCase().includes(term))),
  );
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The grid as Workiz's Export writes it — the rows on show. */
export function itemGroupsToCsv(rows: readonly ItemGroupRow[]): string {
  const head = ["Name", "Description", "Items", "Group type", "Total", "Category"];
  const lines = rows.map((r) =>
    [r.name, r.description, r.items, r.groupType, r.total.toFixed(2), r.category].map(csvCell).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}

/* ------------------------------------------------------------------ *
 * The Create / Edit item group popup
 * ------------------------------------------------------------------ */

/** A line of the popup's grid: what the boxes hold (text, as typed), the rest carried through. */
export interface GroupDraftLine {
  /** React key — a line can repeat an item. */
  key: string;
  productId: string;
  name: string;
  /** The item's type, for Workiz's chip under the name. */
  type?: ProductType | string;
  quantity: string;
  price: string;
  /** "" when the caller may not see costs (nothing is sent then). */
  cost: string;
  taxable?: boolean;
  description?: string;
  customAttributes?: Record<string, string>;
}

let seq = 0;
const nextKey = () => `line-${++seq}`;

const text = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "");

/** A group's members as the popup's lines. */
export function draftLinesFromGroup(group: ItemGroup): GroupDraftLine[] {
  return group.members.map((m: ItemGroupMember) => ({
    key: nextKey(),
    productId: m.productId,
    name: m.name,
    quantity: text(m.quantity),
    price: text(m.priceClient),
    cost: text(m.cost),
    taxable: m.taxable,
    description: m.description,
    customAttributes: m.customAttributes,
  }));
}

/**
 * A job's lines as a new group's (Workiz's save-as-group icon after "Job
 * Items"): each line's item, name, quantity, price, taxable flag, description
 * and custom field values; its company cost only for a caller who may see it.
 */
export function draftLinesFromJobLines(
  lines: readonly Pick<
    DealProduct,
    "productId" | "name" | "quantity" | "priceClient" | "costCompany" | "taxable" | "description" | "customAttributes"
  >[],
  { canSeeCost }: { canSeeCost: boolean },
): GroupDraftLine[] {
  return lines.map((l) => ({
    key: nextKey(),
    productId: l.productId,
    name: l.name,
    quantity: text(l.quantity),
    price: text(l.priceClient),
    cost: canSeeCost ? text(l.costCompany) : "",
    taxable: l.taxable !== false,
    description: l.description ?? "",
    customAttributes: l.customAttributes ?? {},
  }));
}

/** "Add items": one of the item, at its price-book price and company cost. */
export function draftLineFromProduct(product: Product): GroupDraftLine {
  return {
    key: nextKey(),
    productId: product.id,
    name: product.name,
    type: product.type,
    quantity: "1",
    price: text(product.priceClient),
    cost: text(product.costCompany),
  };
}

/** A box's number, or NaN when it holds none. */
function num(s: string): number {
  return s.trim() === "" ? Number.NaN : Number(s);
}

/** Workiz's Amount: price × quantity (0 while either box holds no number). */
export function lineAmount(line: Pick<GroupDraftLine, "price" | "quantity">): number {
  const amount = num(line.price) * num(line.quantity);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

/** Workiz's Margin: (price − cost) / price, "40.15%"; blank without a price or a cost. */
export function lineMargin(line: Pick<GroupDraftLine, "price" | "cost">): string {
  const price = num(line.price);
  const cost = num(line.cost);
  if (!Number.isFinite(price) || !Number.isFinite(cost) || price <= 0) return "";
  return `${(((price - cost) / price) * 100).toFixed(2)}%`;
}

/** Workiz's "Total:" — Σ amount, in cents so 3 × $0.10 is $0.30. */
export function draftTotal(lines: readonly GroupDraftLine[]): number {
  const cents = lines.reduce((sum, l) => sum + Math.round(lineAmount(l) * 100), 0);
  return cents / 100;
}

export interface GroupDraft {
  name: string;
  description: string;
  categoryId: string;
  lines: GroupDraftLine[];
}

export interface GroupDraftErrors {
  name?: string;
  items?: string;
  lines: Record<string, Partial<Record<"quantity" | "price" | "cost", string>>>;
}

/** What stops a Save, or null. Quantity above 0 (fractions are fine), price and cost 0 or more. */
export function validateGroupDraft(draft: Pick<GroupDraft, "name" | "lines">): GroupDraftErrors | null {
  const errors: GroupDraftErrors = { lines: {} };
  if (!draft.name.trim()) errors.name = "Name is required";
  if (draft.lines.length === 0) errors.items = "Add at least one item";
  for (const line of draft.lines) {
    const row: Partial<Record<"quantity" | "price" | "cost", string>> = {};
    const q = num(line.quantity);
    if (!Number.isFinite(q) || q <= 0) row.quantity = "More than 0";
    const p = num(line.price);
    if (!Number.isFinite(p) || p < 0) row.price = "0 or more";
    if (line.cost.trim() !== "") {
      const c = num(line.cost);
      if (!Number.isFinite(c) || c < 0) row.cost = "0 or more";
    }
    if (Object.keys(row).length) errors.lines[line.key] = row;
  }
  return errors.name || errors.items || Object.keys(errors.lines).length ? errors : null;
}

/** The request body. A cost goes only from a caller who may see money, and only when the box holds one. */
export function groupBodyFromDraft(draft: GroupDraft, { canSeeCost }: { canSeeCost: boolean }): ItemGroupBody {
  return {
    name: draft.name.trim(),
    description: draft.description.trim(),
    categoryId: draft.categoryId,
    members: draft.lines.map((l) => {
      const member: ItemGroupMemberBody = {
        productId: l.productId,
        name: l.name,
        quantity: num(l.quantity),
        priceClient: num(l.price),
      };
      if (canSeeCost && l.cost.trim() !== "") member.cost = num(l.cost);
      member.taxable = l.taxable ?? true;
      member.description = l.description ?? "";
      member.customAttributes = l.customAttributes ?? {};
      return member;
    }),
  };
}

const sameMembers = (group: ItemGroup, members: readonly ItemGroupMemberBody[]) =>
  group.members.length === members.length &&
  group.members.every((m, i) => {
    const b = members[i];
    return (
      m.productId === b.productId &&
      m.name === b.name &&
      m.quantity === b.quantity &&
      m.priceClient === b.priceClient &&
      (b.cost === undefined || m.cost === b.cost) &&
      m.taxable === (b.taxable ?? true) &&
      m.description === (b.description ?? "") &&
      JSON.stringify(m.customAttributes) === JSON.stringify(b.customAttributes ?? {})
    );
  });

/** An Edit's PATCH: only what changed; the whole member list when any line did. */
export function changedGroupBody(group: ItemGroup, body: ItemGroupBody): ItemGroupUpdateBody {
  const out: ItemGroupUpdateBody = {};
  if (body.name !== group.name) out.name = body.name;
  if ((body.description ?? "") !== (group.description ?? "")) out.description = body.description;
  if ((body.categoryId ?? "") !== (group.categoryId ?? "")) out.categoryId = body.categoryId ?? "";
  if (!sameMembers(group, body.members)) out.members = body.members;
  return out;
}

/* ------------------------------------------------------------------ *
 * Adding a group to a job or an estimate
 * ------------------------------------------------------------------ */

const byName = (a: ItemGroup, b: ItemGroup) => a.name.localeCompare(b.name, "en", { sensitivity: "base" });

/**
 * The groups an Add item picker offers for what was typed: active, of the
 * type BitCRM adds (Individual items), matching the group's name or an
 * item's; by name.
 */
export function pickableGroups(groups: readonly ItemGroup[] | undefined, search: string): ItemGroup[] {
  const term = search.trim().toLowerCase();
  return (groups ?? [])
    .filter((g) => g.active !== false && (g.groupType ?? "separate_items") === "separate_items" && g.members.length > 0)
    .filter((g) => !term || g.name.toLowerCase().includes(term) || g.members.some((m) => m.name.toLowerCase().includes(term)))
    .sort(byName);
}

/**
 * An estimate's lines from a group: the group's quantity, price, taxable flag,
 * name and description; the price book's SKU, type and costs (what an
 * estimate line carries) — a line whose item the picker's catalog lacks still
 * goes, at no cost.
 */
export function groupEstimateLines(group: ItemGroup, catalog: ReadonlyMap<string, Product>): EstimateItemBody[] {
  return group.members.map((m) => {
    const p = catalog.get(m.productId);
    return {
      productId: m.productId,
      ...(p && { productType: p.type }),
      name: m.name || p?.name || "",
      sku: p?.sku ?? "",
      ...(m.description && { description: m.description }),
      quantity: m.quantity,
      priceClient: m.priceClient,
      costCompany: p?.costCompany ?? 0,
      costForTech: p?.costTech ?? 0,
      taxable: m.taxable,
    };
  });
}
