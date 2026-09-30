/**
 * Keeps TipTap JSON inside the renderer's rich-text allow-list so what the
 * editor stores is exactly what the PDF can render.
 */
import type { RichTextNode } from "@bitcrm/types";
import { RICH_TEXT_MARK_TYPES, RICH_TEXT_NODE_TYPES } from "@bitcrm/document-renderer";

const NODE_TYPES = new Set<string>(RICH_TEXT_NODE_TYPES);
const MARK_TYPES = new Set<string>(RICH_TEXT_MARK_TYPES);

type Mark = NonNullable<RichTextNode["marks"]>[number];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function emptyDoc(): RichTextNode {
  return { type: "doc", content: [{ type: "paragraph" }] };
}

function sanitizeMark(m: unknown): Mark | null {
  if (!isObj(m) || typeof m.type !== "string" || !MARK_TYPES.has(m.type)) return null;
  const attrs = isObj(m.attrs) ? m.attrs : {};
  switch (m.type) {
    case "textStyle":
      return typeof attrs.color === "string" && attrs.color ? { type: "textStyle", attrs: { color: attrs.color } } : null;
    case "link":
      return typeof attrs.href === "string" && attrs.href ? { type: "link", attrs: { href: attrs.href } } : null;
    default:
      return { type: m.type };
  }
}

function sanitizeNode(n: unknown): RichTextNode | null {
  if (!isObj(n) || typeof n.type !== "string" || !NODE_TYPES.has(n.type)) return null;
  const attrs = isObj(n.attrs) ? n.attrs : {};
  const out: RichTextNode = { type: n.type };

  if (n.type === "text") {
    if (typeof n.text !== "string" || n.text === "") return null;
    out.text = n.text;
  } else if (n.type === "mergeTag") {
    if (typeof attrs.path !== "string" || !attrs.path) return null;
    out.attrs = { path: attrs.path };
  } else if (n.type === "heading") {
    const level = Math.min(3, Math.max(1, Math.round(Number(attrs.level) || 1)));
    out.attrs = { level };
  }

  if (Array.isArray(n.marks) && (n.type === "text" || n.type === "mergeTag")) {
    const marks = n.marks.map(sanitizeMark).filter((m): m is Mark => m !== null);
    if (marks.length) out.marks = marks;
  }

  if (Array.isArray(n.content) && n.type !== "text" && n.type !== "mergeTag" && n.type !== "hardBreak") {
    const content = n.content.map(sanitizeNode).filter((c): c is RichTextNode => c !== null);
    if (content.length) out.content = content;
  }
  return out;
}

/** Returns an allow-listed `doc` (never empty: at least one paragraph). */
export function sanitizeRichText(input: unknown): RichTextNode {
  const node = sanitizeNode(input);
  if (!node || node.type !== "doc" || !node.content?.length) {
    return node && node.type !== "doc" ? { type: "doc", content: [node] } : emptyDoc();
  }
  return node;
}

/** True when a doc has no visible text and no merge tags. */
export function isEmptyDoc(node: RichTextNode | undefined): boolean {
  if (!node) return true;
  if (node.type === "mergeTag") return false;
  if (node.type === "text") return !node.text;
  return (node.content ?? []).every(isEmptyDoc);
}
