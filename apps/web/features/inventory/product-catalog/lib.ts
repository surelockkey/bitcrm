import { InventoryStatus, type Brand, type ProductCategoryWithCounts } from "@bitcrm/types";

/** A category plus how deep it sits, so the table can indent it. */
export type CategoryTreeRow = ProductCategoryWithCounts & { depth: number };

function matches(query: string, ...fields: (string | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
}

export function searchBrands(brands: Brand[] | undefined, query: string): Brand[] {
  return (brands ?? []).filter((b) => matches(query, b.name, b.description));
}

export function searchCategories(
  categories: ProductCategoryWithCounts[] | undefined,
  query: string,
): ProductCategoryWithCounts[] {
  return (categories ?? []).filter((c) =>
    matches(query, c.name, c.description, c.parentName),
  );
}

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

/**
 * Orders a flat category list into parent-then-children reading order.
 *
 * A category whose parent isn't in the list — filtered out by a search, or
 * archived away — is treated as a root rather than dropped, so a row that
 * matched the query never silently disappears.
 */
export function buildCategoryTree(
  categories: ProductCategoryWithCounts[],
): CategoryTreeRow[] {
  const present = new Set(categories.map((c) => c.id));
  const childrenOf = new Map<string, ProductCategoryWithCounts[]>();
  const roots: ProductCategoryWithCounts[] = [];

  for (const category of categories) {
    const parentId = category.parentId;
    if (parentId && present.has(parentId)) {
      const siblings = childrenOf.get(parentId) ?? [];
      siblings.push(category);
      childrenOf.set(parentId, siblings);
    } else {
      roots.push(category);
    }
  }

  const out: CategoryTreeRow[] = [];
  const seen = new Set<string>();

  const walk = (nodes: ProductCategoryWithCounts[], depth: number) => {
    for (const node of [...nodes].sort(byName)) {
      // Bad data could point two categories at each other; bail rather than recurse forever.
      if (seen.has(node.id)) continue;
      seen.add(node.id);
      out.push({ ...node, depth });
      walk(childrenOf.get(node.id) ?? [], depth + 1);
    }
  };

  walk(roots, 0);

  // Anything left is part of a parent cycle — still show it, flat.
  for (const category of categories) {
    if (!seen.has(category.id)) out.push({ ...category, depth: 0 });
  }

  return out;
}

/**
 * Categories a given one may be filed under. Excludes itself and everything
 * beneath it — re-parenting a category under its own descendant would tear the
 * subtree off the root, which the backend rejects outright.
 */
export function parentOptions(
  categories: ProductCategoryWithCounts[],
  editingId?: string,
): CategoryTreeRow[] {
  const active = categories.filter((c) => c.status === InventoryStatus.ACTIVE);
  const tree = buildCategoryTree(active);
  if (!editingId) return tree;

  const blocked = new Set([editingId]);
  // The tree is in parent-before-child order, so one pass closes the subtree.
  for (const row of tree) {
    if (row.parentId && blocked.has(row.parentId)) blocked.add(row.id);
  }

  return tree.filter((row) => !blocked.has(row.id));
}
