import type {
  ContainerTemplate,
  ContainerTemplateDiff,
  ContainerTemplateDiffLine,
  ContainerTemplateFillResult,
  LocationStockRow,
} from "@bitcrm/types";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** The Units column: every target quantity added up. */
export function templateUnits(t: Pick<ContainerTemplate, "items">): number {
  return t.items.reduce((n, i) => n + i.quantity, 0);
}

/** The Used by column: how many vans name this template. */
export function usedByCount(templateId: string, vans: { templateId?: string }[]): number {
  return vans.filter((v) => v.templateId === templateId).length;
}

/** The line under the Apply table: what is missing, and what a fill would move. */
export function diffSummary(diff: ContainerTemplateDiff): { text: string; willMove: number } {
  const willMove = diff.lines.reduce((n, l) => n + (l.willMove ?? 0), 0);
  if (diff.shortLineCount === 0) {
    return { text: "Nothing missing — the van matches the template", willMove };
  }
  const missing = `${plural(diff.shortLineCount, "line")} missing, ${plural(diff.missingUnits, "unit")}`;
  return { text: `${missing}; ${plural(willMove, "unit")} will move`, willMove };
}

const shortText = (lines: ContainerTemplateDiffLine[]) =>
  lines.map((l) => `${l.productName} (${l.missing - (l.willMove ?? 0)})`).join(", ");

/**
 * What a fill did, counted from the answer: the units that moved, and every
 * line still short afterwards — by name, with how many it still lacks.
 */
export function fillMessages(
  result: Pick<ContainerTemplateFillResult, "moved" | "short">,
  containerName: string,
): { success?: string; warning?: string } {
  const moved = result.moved.reduce((n, l) => n + (l.willMove ?? 0), 0);
  if (moved === 0) {
    return {
      success: undefined,
      warning: result.short.length ? `Nothing moved — still short: ${shortText(result.short)}` : "Nothing to move",
    };
  }
  return {
    success: `Moved ${plural(moved, "unit")} to ${containerName}`,
    warning: result.short.length ? `Still short: ${shortText(result.short)}` : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * The template editor's lines
 * ------------------------------------------------------------------ */

/** A line being edited: the quantity is what the field holds. */
export interface DraftLine {
  productId: string;
  productName: string;
  sku?: string;
  quantity: string;
}

/**
 * A product added from the search. Each product once: one already on the
 * template is not added again — the editor focuses its quantity instead.
 */
export function addLine(
  lines: DraftLine[],
  product: { id: string; name: string; sku?: string },
): { lines: DraftLine[]; focus: string } {
  if (lines.some((l) => l.productId === product.id)) return { lines, focus: product.id };
  return {
    lines: [...lines, { productId: product.id, productName: product.name, sku: product.sku, quantity: "1" }],
    focus: product.id,
  };
}

/** A target quantity: whole units, at least 1. */
export function checkLineQuantity(raw: string): { quantity: number | null; error: string | null } {
  const text = raw.trim();
  if (!text) return { quantity: null, error: "Enter a quantity" };
  const n = Number(text);
  if (!Number.isInteger(n)) return { quantity: null, error: "Whole units only" };
  if (n < 1) return { quantity: null, error: "Enter 1 or more" };
  return { quantity: n, error: null };
}

/** The most lines a template takes — the server refuses more (`MAX_TEMPLATE_ITEMS`). */
export const MAX_TEMPLATE_LINES = 500;

/* ------------------------------------------------------------------ *
 * Copy from location
 * ------------------------------------------------------------------ */

/**
 * What a warehouse or a van holds now, as template lines: one per product,
 * the quantity it holds as the target (whole units, at least 1). A row whose
 * item is gone from the catalog (the server sends it without its Product ID
 * and SKU) is left out — a template can only name items that exist.
 */
export function linesFromStock(rows: LocationStockRow[]): { lines: DraftLine[]; skipped: number } {
  const lines: DraftLine[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const row of rows) {
    if (row.quantity <= 0 || seen.has(row.productId)) continue;
    if (row.number === undefined && row.sku === undefined) {
      skipped += 1;
      continue;
    }
    seen.add(row.productId);
    lines.push({
      productId: row.productId,
      productName: row.productName,
      sku: row.sku,
      quantity: String(Math.max(1, Math.round(row.quantity))),
    });
  }
  return { lines, skipped };
}

/** Replace — the template becomes the location's lines. Merge — its lines stay; the products it lacks are added. */
export type CopyMode = "replace" | "merge";

export function copyLines(current: DraftLine[], incoming: DraftLine[], mode: CopyMode): DraftLine[] {
  if (mode === "replace") return incoming;
  const have = new Set(current.map((l) => l.productId));
  return [...current, ...incoming.filter((l) => !have.has(l.productId))];
}
