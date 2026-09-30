import type {
  ContainerTemplate,
  ContainerTemplateDiff,
  ContainerTemplateDiffLine,
  ContainerTemplateFillResult,
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
