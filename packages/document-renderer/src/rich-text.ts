import type { DocumentRenderContext, RichTextNode } from '@bitcrm/types';
import { LIMITS } from './defaults';
import { escapeHtml, safeColor, safeUrl } from './escape';
import { interpolate, resolveMergeTag } from './merge-tags';

/** Node types the renderer understands; anything else is dropped. */
export const RICH_TEXT_NODE_TYPES = [
  'doc',
  'paragraph',
  'heading',
  'text',
  'hardBreak',
  'bulletList',
  'orderedList',
  'listItem',
  'mergeTag',
] as const;

export const RICH_TEXT_MARK_TYPES = ['bold', 'italic', 'underline', 'textStyle', 'link'] as const;

const TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify']);

type Mark = NonNullable<RichTextNode['marks']>[number];

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function headingLevel(attrs: unknown): 1 | 2 | 3 {
  const raw = isObj(attrs) ? Number(attrs.level) : NaN;
  if (!Number.isFinite(raw)) return 1;
  return Math.min(3, Math.max(1, Math.round(raw))) as 1 | 2 | 3;
}

function alignAttr(attrs: unknown): string {
  const a = isObj(attrs) ? attrs.textAlign : undefined;
  return typeof a === 'string' && TEXT_ALIGNS.has(a) && a !== 'left' ? ` style="text-align:${a}"` : '';
}

function applyMark(inner: string, mark: Mark): string {
  if (!isObj(mark)) return inner;
  switch (mark.type) {
    case 'bold':
      return `<strong>${inner}</strong>`;
    case 'italic':
      return `<em>${inner}</em>`;
    case 'underline':
      return `<u>${inner}</u>`;
    case 'textStyle': {
      const color = safeColor(isObj(mark.attrs) ? mark.attrs.color : undefined);
      return color ? `<span style="color:${color}">${inner}</span>` : inner;
    }
    case 'link': {
      const href = safeUrl(isObj(mark.attrs) ? mark.attrs.href : undefined, 'link');
      return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>` : inner;
    }
    default:
      return inner;
  }
}

function withMarks(inner: string, marks: unknown): string {
  if (!Array.isArray(marks)) return inner;
  // Links wrap outermost so styled text inside stays clickable as one anchor.
  const ordered = [...marks].sort((a, b) => Number(isObj(a) && a.type === 'link') - Number(isObj(b) && b.type === 'link'));
  return ordered.reduce<string>((acc, m) => applyMark(acc, m as Mark), inner);
}

const TAG_IN_TEXT = /\{\{\s*([A-Za-z0-9_.-]{1,200})\s*\}\}/g;

/**
 * True when a paragraph/heading references at least one merge tag and every
 * one of them resolves to an empty value — such lines are collapsed so that
 * e.g. an address block without a company name leaves no blank line.
 */
function allTagsEmpty(node: Record<string, unknown>, ctx: DocumentRenderContext): boolean {
  if (!Array.isArray(node.content) || node.content.length === 0) return false;
  let tags = 0;
  for (const child of node.content) {
    if (!isObj(child)) continue;
    if (child.type === 'mergeTag') {
      tags++;
      const path = isObj(child.attrs) && typeof child.attrs.path === 'string' ? child.attrs.path : '';
      if (resolveMergeTag(path, ctx).trim()) return false;
    } else if (child.type === 'text' && typeof child.text === 'string') {
      for (const m of child.text.matchAll(TAG_IN_TEXT)) {
        tags++;
        if (resolveMergeTag(m[1], ctx).trim()) return false;
      }
    }
  }
  return tags > 0;
}

/**
 * Renders a TipTap JSON tree from the allow-list. Text is interpolated
 * (`{{path}}`) and escaped; `mergeTag` nodes resolve to escaped values.
 */
export function renderRichText(node: unknown, ctx: DocumentRenderContext, depth = 0): string {
  if (!isObj(node) || depth > LIMITS.maxRichTextDepth + 4) return '';
  const children = (): string =>
    Array.isArray(node.content) ? node.content.map((c) => renderRichText(c, ctx, depth + 1)).join('') : '';

  switch (node.type) {
    case 'doc':
      return children();
    case 'paragraph': {
      if (allTagsEmpty(node, ctx)) return '';
      return `<p${alignAttr(node.attrs)}>${children() || '<br>'}</p>`;
    }
    case 'heading': {
      if (allTagsEmpty(node, ctx)) return '';
      const level = headingLevel(node.attrs);
      return `<h${level}${alignAttr(node.attrs)}>${children() || '<br>'}</h${level}>`;
    }
    case 'text': {
      if (typeof node.text !== 'string' || node.text === '') return '';
      return withMarks(escapeHtml(interpolate(node.text, ctx)), node.marks);
    }
    case 'mergeTag': {
      const path = isObj(node.attrs) && typeof node.attrs.path === 'string' ? node.attrs.path : '';
      const value = escapeHtml(resolveMergeTag(path, ctx));
      return value ? withMarks(value, node.marks) : '';
    }
    case 'hardBreak':
      return '<br>';
    case 'bulletList':
      return `<ul>${children()}</ul>`;
    case 'orderedList':
      return `<ol>${children()}</ol>`;
    case 'listItem':
      return `<li>${children()}</li>`;
    default:
      return '';
  }
}
