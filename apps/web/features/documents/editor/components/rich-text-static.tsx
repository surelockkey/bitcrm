"use client";

import { memo, type ReactNode } from "react";
import type { RichTextNode } from "@bitcrm/types";
import { safeColor, safeUrl } from "@bitcrm/document-renderer";
import { mergeTagLabel } from "../../lib";
import { isEmptyDoc } from "../rich-text";

type Mark = NonNullable<RichTextNode["marks"]>[number];

function withMarks(inner: ReactNode, marks: Mark[] | undefined, key: string): ReactNode {
  if (!marks?.length) return inner;
  // Links outermost, like the renderer.
  const ordered = [...marks].sort((a, b) => Number(a.type === "link") - Number(b.type === "link"));
  return ordered.reduce<ReactNode>((acc, m, i) => {
    const k = `${key}-m${i}`;
    switch (m.type) {
      case "bold":
        return <strong key={k}>{acc}</strong>;
      case "italic":
        return <em key={k}>{acc}</em>;
      case "underline":
        return <u key={k}>{acc}</u>;
      case "textStyle": {
        const color = safeColor(m.attrs?.color);
        return color ? <span key={k} style={{ color }}>{acc}</span> : acc;
      }
      case "link": {
        const href = safeUrl(m.attrs?.href, "link");
        // Not clickable on the canvas — a click selects the block.
        return href ? <a key={k} href={href} onClick={(e) => e.preventDefault()}>{acc}</a> : acc;
      }
      default:
        return acc;
    }
  }, inner);
}

function renderNode(node: RichTextNode, key: string): ReactNode {
  const children = () => (node.content ?? []).map((c, i) => renderNode(c, `${key}.${i}`));
  switch (node.type) {
    case "doc":
      return <>{children()}</>;
    case "paragraph": {
      const kids = children();
      return <p key={key}>{kids.length ? kids : <br />}</p>;
    }
    case "heading": {
      const level = Math.min(3, Math.max(1, Number(node.attrs?.level) || 1));
      const Tag = `h${level}` as "h1" | "h2" | "h3";
      const kids = children();
      return <Tag key={key}>{kids.length ? kids : <br />}</Tag>;
    }
    case "text":
      return node.text ? withMarks(node.text, node.marks, key) : null;
    case "mergeTag": {
      const path = typeof node.attrs?.path === "string" ? node.attrs.path : "";
      return withMarks(
        <span key={key} className="merge-chip" data-merge-tag={path} title={`{{${path}}}`}>
          {mergeTagLabel(path)}
        </span>,
        node.marks,
        key,
      );
    }
    case "hardBreak":
      return <br key={key} />;
    case "bulletList":
      return <ul key={key}>{children()}</ul>;
    case "orderedList":
      return <ol key={key}>{children()}</ol>;
    case "listItem":
      return <li key={key}>{children()}</li>;
    default:
      return null;
  }
}

/** Read-only React rendering of rich text, merge tags shown as chips. */
export const RichTextStatic = memo(function RichTextStatic({ node, placeholder }: { node: RichTextNode; placeholder?: string }) {
  if (placeholder && isEmptyDoc(node)) {
    return <p className="rt-placeholder">{placeholder}</p>;
  }
  return <>{renderNode(node, "n")}</>;
});
