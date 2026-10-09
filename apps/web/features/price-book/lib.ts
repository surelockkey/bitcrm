import { InventoryStatus, ProductType, UNCATEGORIZED_CATEGORY } from "@bitcrm/types";
import type { Brand, Product, ProductCategory } from "@bitcrm/types";
import type { WzFilterGroup, WzFilterValue } from "@/components/workiz/grouped-filter";
import { isService, typeLabel } from "@/features/inventory/products/lib";
import type { ProductFilter } from "@/features/inventory/products/lib";

/* ------------------------------------------------------------------ *
 * Items — Workiz's "Show:" box and what the server reads of it
 * ------------------------------------------------------------------ */

/**
 * The Show box's groups: Workiz's ITEM TYPE, STATUS, CATEGORY and BRAND
 * (pg_pricebook_wz_02_show_open), then ours, INVENTORY — Workiz's
 * "Inventory" column as a filter (stock-managed or not).
 */
export type ShowGroup = "type" | "status" | "category" | "brand" | "inventory";
export type ShowValue = WzFilterValue<ShowGroup>;

/** Workiz opens on one chip, "status: Active items". */
export const SHOW_DEFAULT: ShowValue = { status: ["active"] };

/** The groups the server reads one value of: a second pick replaces the first. */
const ONE_AT_A_TIME: readonly ShowGroup[] = ["category", "brand"];

/**
 * The Show box after a change. The server filters by one category and one
 * brand, so picking another keeps only the newest; Item type, Status and
 * Inventory hold two values each, and both picked is the same as none.
 */
export function normalizeShow(prev: ShowValue, next: ShowValue): ShowValue {
  const out: ShowValue = { ...next };
  for (const key of ONE_AT_A_TIME) {
    const values = next[key];
    if (!values || values.length < 2) continue;
    const added = values.filter((v) => !(prev[key] ?? []).includes(v));
    out[key] = [added.at(-1) ?? values.at(-1)!];
  }
  return out;
}

/** The one value a group narrows to, or nothing when it holds none or every one. */
function only(values: string[] | undefined): string | undefined {
  return values?.length === 1 ? values[0] : undefined;
}

/** The Show box and the Search as query params — every choice at once; nothing is filtered here. */
export function toProductFilter(show: ShowValue, search: string): ProductFilter {
  const out: ProductFilter = {};
  const term = search.trim();
  if (term) out.search = term;
  const type = only(show.type);
  if (type) out.type = type as ProductType;
  const category = show.category?.at(-1);
  if (category) out.category = category;
  const brand = show.brand?.at(-1);
  if (brand) out.brandId = brand;
  const status = only(show.status);
  if (status) out.status = status as InventoryStatus;
  const inventory = only(show.inventory);
  if (inventory) out.manageStock = inventory === "yes";
  return out;
}

const byName = (a: string, b: string) => a.localeCompare(b, "en", { sensitivity: "base" });
const isUncategorized = (name: string) => name.trim().toLowerCase() === UNCATEGORIZED_CATEGORY.toLowerCase();

/** A row the Workiz import wrote carries Workiz's id (`workiz:category:1510`); BitCRM's own have none. */
function workizRank(e: { externalId?: string }): number {
  const m = /^workiz:[a-z_]+:(\d+)$/.exec(e.externalId ?? "");
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * Workiz's own order — it lists its catalogs by id, oldest first
 * (pg_pricebook_wz_02_show_open, _11_categories, _12_brands) — then the rows
 * BitCRM made, by name.
 */
function workizOrder(a: { externalId?: string; name: string }, b: { externalId?: string; name: string }): number {
  const ra = workizRank(a);
  const rb = workizRank(b);
  if (ra !== rb) return ra < rb ? -1 : 1;
  return byName(a.name, b.name);
}

/**
 * The Show menu. Categories are offered by their own name and filed by the
 * full one items carry ("Platinum > Private"); BitCRM's "Uncategorized"
 * (Workiz has no such category) goes last. A catalog the reader may not see
 * is left out.
 */
export function showGroups({
  categories,
  brands,
  canCategories,
  canBrands,
}: {
  categories: readonly ProductCategory[] | undefined;
  brands: readonly Brand[] | undefined;
  canCategories: boolean;
  canBrands: boolean;
}): WzFilterGroup<ShowGroup>[] {
  const tree = catalogRows(categories).map((r) => r.fullName);
  const names = [
    ...new Set([...tree, ...(categories ?? []).map((c) => c.name).filter((n) => isUncategorized(n))]),
  ];
  const groups: (WzFilterGroup<ShowGroup> | null)[] = [
    {
      key: "type",
      label: "Item type",
      chip: "type",
      options: [
        { value: ProductType.PRODUCT, label: "Product" },
        { value: ProductType.SERVICE, label: "Service" },
      ],
    },
    {
      key: "status",
      label: "Status",
      chip: "status",
      options: [
        { value: InventoryStatus.ACTIVE, label: "Active items" },
        { value: InventoryStatus.ARCHIVED, label: "Disabled items" },
      ],
    },
    canCategories
      ? {
          key: "category",
          label: "Category",
          chip: "category",
          options: names.map((name) => ({ value: name, label: leafCategoryName(name).name })),
        }
      : null,
    canBrands
      ? {
          key: "brand",
          label: "Brand",
          chip: "brand",
          options: [...(brands ?? [])]
            .sort(workizOrder)
            .map((b) => ({ value: b.id, label: b.name })),
        }
      : null,
    {
      key: "inventory",
      label: "Inventory",
      chip: "inventory",
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
  ];
  return groups.filter((g): g is WzFilterGroup<ShowGroup> => g !== null);
}

/* ------------------------------------------------------------------ *
 * Row words — what Workiz's grid prints
 * ------------------------------------------------------------------ */

/** "Product", "Service" — or Workiz's own word for an imported `hours` / `other` item. */
export function itemTypeLabel(p: Pick<Product, "type" | "workizType">): string {
  if (p.workizType) return p.workizType.charAt(0).toUpperCase() + p.workizType.slice(1);
  return typeLabel(p.type);
}

/** Workiz's "Inventory": a service never is; a product is unless switched off (absent ⇒ Yes). */
export function inventoryLabel(p: Pick<Product, "type" | "manageStock">): string {
  if (isService(p)) return "No";
  return p.manageStock === false ? "No" : "Yes";
}

/** Workiz's "Booking": offered in online booking (absent ⇒ No). */
export function bookingLabel(p: Pick<Product, "availableInBooking">): string {
  return p.availableInBooking ? "Yes" : "No";
}

/** Absent ⇒ taxable, as on the server. */
export function taxableLabel(p: Pick<Product, "taxable">): string {
  return p.taxable === false ? "No" : "Yes";
}

/** A category as Workiz prints it: its own name, without its parents; "Uncategorized" as nothing. */
export function categoryLeaf(name: string | undefined): string {
  if (!name || isUncategorized(name)) return "";
  return leafCategoryName(name).name;
}

/** Brand id → name, archived brands included: an item still names its old brand. */
export function brandNameMap(brands: readonly Brand[] | undefined): Map<string, string> {
  return new Map((brands ?? []).map((b) => [b.id, b.name]));
}

/* ------------------------------------------------------------------ *
 * The Categories and Brands tabs
 * ------------------------------------------------------------------ */

/**
 * A category or a brand as the API answers: the catalog row plus what the
 * Workiz import (and now the API) keeps on it — a description, a category's
 * parent and its Workiz picture.
 */
export type CatalogEntry = (ProductCategory | Brand) & {
  description?: string;
  parentId?: string;
  workizFilePath?: string;
  /** `workiz:category:<id>` / `workiz:brand:<id>` on an imported row. */
  externalId?: string;
};

/** One grid row of the Categories or Brands tab. */
export interface CatalogRow {
  id: string;
  /** Its own name ("Private Platinum Clients"). */
  name: string;
  /** The name items carry ("Platinum Client's > Private Platinum Clients"). */
  fullName: string;
  /** Where its parents' names end — kept when the name is edited. */
  parentPath: string;
  parentName: string;
  description: string;
  picture?: string;
  active: boolean;
  /** It holds sub-categories (Workiz then refuses to delete it). */
  hasChildren: boolean;
  entry: CatalogEntry;
}

const SEP = " > ";

/** "A > B > C" → its parents' path "A > B" and its own name "C". */
export function leafCategoryName(fullName: string): { parentPath: string; name: string } {
  const at = fullName.lastIndexOf(SEP);
  return at < 0
    ? { parentPath: "", name: fullName }
    : { parentPath: fullName.slice(0, at), name: fullName.slice(at + SEP.length) };
}

/** A renamed category's full name: its parents stay. */
export function withParentPath(parentPath: string, name: string): string {
  const own = name.trim();
  return parentPath ? `${parentPath}${SEP}${own}` : own;
}

/**
 * The grid's rows, in the catalog's tree order (a parent right before its
 * children). Each prints its own name and its parent's own name — the
 * parent row when the import linked it, else the path's last step.
 * BitCRM's "Uncategorized" sentinel is not a category a Workiz user knows,
 * and cannot be renamed: left out.
 */
export function catalogRows(entries: readonly CatalogEntry[] | undefined): CatalogRow[] {
  const all = (entries ?? []).filter((e) => !isUncategorized(e.name));
  const byId = new Map(all.map((e) => [e.id, e]));
  const byFullName = new Map(all.map((e) => [e.name, e]));
  const parentOf = (e: CatalogEntry): CatalogEntry | undefined =>
    (e.parentId ? byId.get(e.parentId) : undefined) ?? byFullName.get(leafCategoryName(e.name).parentPath);

  // Workiz's order, each parent followed by its children (the tree, walked).
  const children = new Map<string | null, CatalogEntry[]>();
  for (const e of all) {
    const parent = parentOf(e);
    const key = parent && parent.id !== e.id ? parent.id : null;
    children.set(key, [...(children.get(key) ?? []), e]);
  }
  const rank = (a: CatalogEntry, b: CatalogEntry) => workizOrder(a, b);
  const ordered: CatalogEntry[] = [];
  const seen = new Set<string>();
  const walk = (key: string | null) => {
    for (const e of [...(children.get(key) ?? [])].sort(rank)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      ordered.push(e);
      walk(e.id);
    }
  };
  walk(null);
  // A loop of parents (never in Workiz's data) still lists every row.
  for (const e of [...all].sort(rank)) if (!seen.has(e.id)) ordered.push(e);

  return ordered.map((e) => {
    const { parentPath, name } = leafCategoryName(e.name);
    const parent = parentOf(e);
    return {
      id: e.id,
      name,
      fullName: e.name,
      parentPath,
      parentName: parent ? leafCategoryName(parent.name).name : parentPath ? leafCategoryName(parentPath).name : "",
      description: e.description ?? "",
      ...(e.workizFilePath && { picture: e.workizFilePath }),
      active: e.active,
      hasChildren: (children.get(e.id)?.length ?? 0) > 0,
      entry: e,
    };
  });
}

/** Workiz's status box over a catalog: Active (default), All or Disabled. */
export type CatalogStatus = "active" | "all" | "disabled";

/** The rows under the status box and the Search (name or description, any case). */
export function filterCatalog(rows: readonly CatalogRow[], status: CatalogStatus, search: string): CatalogRow[] {
  const term = search.trim().toLowerCase();
  return rows.filter(
    (r) =>
      (status === "all" || r.active === (status === "active")) &&
      (!term || r.name.toLowerCase().includes(term) || r.description.toLowerCase().includes(term)),
  );
}

function csvCell(value: string | number | undefined): string {
  const s = value === undefined ? "" : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The Categories grid as Workiz's Export writes it: the rows on show, their active-item counts beside them. */
export function catalogsToCsv(rows: readonly CatalogRow[], counts: ReadonlyMap<string, number>): string {
  const head = ["Name", "Description", "Parent category", "No. of active items"];
  const lines = rows.map((r) =>
    [r.name, r.description, r.parentName, counts.get(r.fullName)].map(csvCell).join(","),
  );
  return [head.join(","), ...lines].join("\n");
}
