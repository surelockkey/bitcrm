import type { CSSProperties } from "react";
import type {
  BlockStyle,
  DocumentPageSettings,
  DocumentTemplate,
  DocumentTemplateContent,
  DocumentTemplateKind,
  DocumentTemplateSummary,
} from "@bitcrm/types";
import { DEFAULT_DOCUMENT_VISIBILITY } from "@bitcrm/types";
import {
  LIMITS,
  MERGE_TAGS,
  MERGE_TAG_GROUPS,
  renderDocumentHtml,
  safeColor,
  sampleRenderContext,
  type MergeTagDef,
  type MergeTagGroupId,
} from "@bitcrm/document-renderer";
import { ApiError } from "@/lib/api/errors";

export const KIND_ORDER: DocumentTemplateKind[] = ["invoice", "estimate", "custom"];

export const KIND_LABELS: Record<DocumentTemplateKind, { singular: string; plural: string }> = {
  invoice: { singular: "Invoice", plural: "Invoices" },
  estimate: { singular: "Estimate", plural: "Estimates" },
  custom: { singular: "Custom document", plural: "Custom documents" },
};

/** Only invoice and estimate templates have a default and auto-apply rules. */
export const kindHasDefault = (kind: DocumentTemplateKind): boolean => kind !== "custom";

export interface TemplateGroup {
  kind: DocumentTemplateKind;
  label: string;
  templates: DocumentTemplateSummary[];
}

export function groupTemplatesByKind(list: DocumentTemplateSummary[]): TemplateGroup[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    label: KIND_LABELS[kind].plural,
    templates: list
      .filter((t) => t.kind === kind)
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name)),
  }));
}

function namesPart(ids: string[] | undefined, names: Map<string, string>, noun: string): string | null {
  if (!ids?.length) return null;
  const known = ids.map((id) => names.get(id)).filter((n): n is string => !!n).slice(0, 2);
  const rest = ids.length - known.length;
  const more = rest > 0 ? `${rest} more ${noun}${rest > 1 ? "s" : ""}` : null;
  return [...known, more].filter(Boolean).join(", ");
}

/** "Auto-applies to Rekey, 1 more job type · North · KeyPro" — or null when never auto-applied. */
export function autoApplySummary(
  autoApply: DocumentTemplate["autoApply"],
  names: { jobTypes: Map<string, string>; serviceAreas: Map<string, string>; companies?: Map<string, string> },
): string | null {
  const parts = [
    namesPart(autoApply?.jobTypeIds, names.jobTypes, "job type"),
    namesPart(autoApply?.serviceAreaIds, names.serviceAreas, "service area"),
    namesPart(autoApply?.businessProfileIds, names.companies ?? new Map(), "company"),
  ].filter((p): p is string => !!p);
  return parts.length ? `Auto-applies to ${parts.join(" · ")}` : null;
}

export function isVersionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.status === 409;
}

/* ------------------------------------------------------------ row layouts */

export interface RowLayout {
  id: string;
  label: string;
  spans: number[];
}

export const ROW_LAYOUTS: RowLayout[] = [
  { id: "1", label: "1 column", spans: [12] },
  { id: "2", label: "2 columns", spans: [6, 6] },
  { id: "2-left", label: "2 columns, narrow left", spans: [4, 8] },
  { id: "2-right", label: "2 columns, narrow right", spans: [8, 4] },
  { id: "3", label: "3 columns", spans: [4, 4, 4] },
  { id: "4", label: "4 columns", spans: [3, 3, 3, 3] },
];

export const spansLabel = (spans: number[]): string => spans.join("/");

/* -------------------------------------------------------------- merge tags */

export interface MergeTagGroup {
  id: MergeTagGroupId;
  label: string;
  tags: MergeTagDef[];
}

export function mergeTagsForKind(kind: DocumentTemplateKind, query: string): MergeTagGroup[] {
  const q = query.trim().toLowerCase();
  const tags = MERGE_TAGS.filter(
    (t) => t.kinds.includes(kind) && (!q || t.label.toLowerCase().includes(q) || t.path.toLowerCase().includes(q)),
  );
  return MERGE_TAG_GROUPS.map((g) => ({ ...g, tags: tags.filter((t) => t.group === g.id) })).filter((g) => g.tags.length);
}

const TAG_BY_PATH = new Map(MERGE_TAGS.map((t) => [t.path, t]));

export function mergeTagLabel(path: string): string {
  const def = TAG_BY_PATH.get(path);
  if (def) return def.label;
  if (path.startsWith("job.customFields.")) return path.slice("job.customFields.".length);
  return path;
}

/* ------------------------------------------------------------------ styles */

function clamp(v: unknown, min: number, max: number): number | undefined {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

const px = (n: number | undefined) => (n === undefined ? undefined : `${n}px`);

/** React equivalent of the renderer's block style declarations. */
export function blockStyleToCss(style: BlockStyle | undefined): CSSProperties {
  if (!style) return {};
  const out: CSSProperties = {};
  if (style.align === "left" || style.align === "center" || style.align === "right") out.textAlign = style.align;
  const color = safeColor(style.color);
  if (color) out.color = color;
  const bg = safeColor(style.background);
  if (bg) out.background = bg;
  if (style.fontSize !== undefined) out.fontSize = px(clamp(style.fontSize, LIMITS.minFontSize, LIMITS.maxFontSize));
  if (style.fontWeight === "bold") out.fontWeight = 700;
  else if (style.fontWeight === "normal") out.fontWeight = 400;
  for (const key of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"] as const) {
    if (style[key] !== undefined) out[key] = px(clamp(style[key], 0, LIMITS.maxPadding));
  }
  const bw = clamp(style.borderWidth, 0, LIMITS.maxBorderWidth) ?? 0;
  if (bw > 0) out.border = `${bw}px solid ${safeColor(style.borderColor) ?? "#d1d5db"}`;
  if (style.borderRadius !== undefined) out.borderRadius = px(clamp(style.borderRadius, 0, LIMITS.maxBorderRadius));
  for (const k of Object.keys(out) as (keyof CSSProperties)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/* ------------------------------------------------------------- scoped css */

const ROOTS = new Set([":root", "html", "body"]);

function scopeSelector(sel: string, scope: string): string {
  const s = sel.trim();
  if (ROOTS.has(s)) return scope;
  const m = /^(html|body)\s+(.*)$/.exec(s);
  if (m) return `${scope} ${m[2]}`;
  return `${scope} ${s}`;
}

/**
 * Prefixes every rule of a flat stylesheet with `scope` so the renderer's
 * document CSS can style the in-app canvas. `:root`/`html`/`body` map to the
 * scope itself; at-rules are dropped.
 */
export function scopeCss(css: string, scope: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf("{", i);
    if (open < 0) break;
    const selector = css.slice(i, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const body = css.slice(open + 1, j - 1).trim();
    i = j;
    if (!selector || selector.startsWith("@")) continue;
    const selectors = [...new Set(selector.split(",").map((s) => scopeSelector(s, scope)))];
    out.push(`${selectors.join(",")}{${body}}`);
  }
  return out.join("\n");
}

function emptyDocumentHtml(page: DocumentPageSettings): string {
  return renderDocumentHtml(
    { page, header: [], body: [], footer: [], visibility: DEFAULT_DOCUMENT_VISIBILITY },
    sampleRenderContext("custom"),
    { mode: "screen" },
  );
}

/** The renderer's screen stylesheet (paper, rows, blocks) scoped for the canvas. */
export function rendererCanvasCss(page: DocumentPageSettings, scope: string): string {
  const html = emptyDocumentHtml(page);
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join("\n");
  return scopeCss(css, scope);
}

/** The web-font stylesheet the renderer links for this page's font, if any. */
export function rendererFontHref(page: DocumentPageSettings): string | null {
  const m = /<link rel="stylesheet" href="([^"]+)">/.exec(emptyDocumentHtml(page));
  return m ? m[1].replace(/&amp;/g, "&") : null;
}

/** Asset ids referenced by image blocks (for resolving their URLs). */
export function collectAssetIds(content: Pick<DocumentTemplateContent, "header" | "body" | "footer"> | undefined): string[] {
  if (!content) return [];
  const out: string[] = [];
  for (const rows of [content.header, content.body, content.footer]) {
    for (const row of rows ?? []) {
      for (const col of row.columns) {
        for (const b of col.blocks) if (b.type === "image" && b.assetId) out.push(b.assetId);
      }
    }
  }
  return out;
}
