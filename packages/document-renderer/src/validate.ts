import type {
  BlockStyle,
  DocumentBlock,
  DocumentBlockType,
  DocumentColumn,
  DocumentPageSettings,
  DocumentRow,
  DocumentTemplateContent,
  DocumentVisibility,
  ItemsTableBlock,
  ItemsTableColumn,
  RichTextNode,
} from '@bitcrm/types';
import { DEFAULT_DOCUMENT_VISIBILITY, DOCUMENT_BLOCK_TYPES, ITEMS_TABLE_COLUMNS } from '@bitcrm/types';
import { DEFAULT_PAGE_SETTINGS, FONT_FAMILIES, LIMITS, PAGE_SIZES } from './defaults';
import { safeColor } from './escape';
import { createBlock } from './factory';
import { newId } from './ids';
import { RICH_TEXT_MARK_TYPES, RICH_TEXT_NODE_TYPES } from './rich-text';

export type ValidationResult =
  | { ok: true; value: DocumentTemplateContent }
  | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_RE = /^[A-Za-z0-9_-]{1,100}$/;
const PATH_RE = /^[A-Za-z0-9_.-]{1,200}$/;
const NODE_TYPES = new Set<string>(RICH_TEXT_NODE_TYPES);
const MARK_TYPES = new Set<string>(RICH_TEXT_MARK_TYPES);
const BLOCK_TYPES = new Set<string>(DOCUMENT_BLOCK_TYPES);
const ITEM_COLUMNS = new Set<string>(ITEMS_TABLE_COLUMNS);
const TEXT_ALIGNS = new Set(['left', 'center', 'right', 'justify']);

class RichTextLimitError extends Error {}

class Validator {
  readonly errors: string[] = [];

  err(path: string, msg: string): void {
    this.errors.push(`${path}: ${msg}`);
  }

  number(v: unknown, path: string, min: number, max: number, def: number): number {
    if (v === undefined) return def;
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.err(path, 'must be a number');
      return def;
    }
    return Math.min(max, Math.max(min, v));
  }

  bool(v: unknown, path: string, def: boolean): boolean {
    if (v === undefined) return def;
    if (typeof v !== 'boolean') {
      this.err(path, 'must be a boolean');
      return def;
    }
    return v;
  }

  optString(v: unknown, path: string, max: number = LIMITS.maxLabelLength): string | undefined {
    if (v === undefined || v === null) return undefined;
    if (typeof v !== 'string') {
      this.err(path, 'must be a string');
      return undefined;
    }
    if (v.length > max) {
      this.err(path, `must be at most ${max} characters`);
      return undefined;
    }
    return v;
  }

  oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[], def: T): T {
    if (v === undefined) return def;
    if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
      this.err(path, `must be one of ${allowed.join(', ')}`);
      return def;
    }
    return v as T;
  }

  optColor(v: unknown, path: string): string | undefined {
    if (v === undefined || v === null || v === '') return undefined;
    const c = safeColor(v);
    if (!c) this.err(path, 'must be a hex, rgb() or named color');
    return c;
  }

  id(v: unknown, path: string): string {
    if (v === undefined || v === null || v === '') return newId();
    if (typeof v !== 'string' || !ID_RE.test(v)) {
      this.err(path, 'must be 1-100 letters, digits, "-" or "_"');
      return newId();
    }
    return v;
  }

  // -- page / visibility ---------------------------------------------------

  page(v: unknown): DocumentPageSettings {
    const d = DEFAULT_PAGE_SETTINGS;
    if (v === undefined) return { ...d };
    if (!isObj(v)) {
      this.err('page', 'must be an object');
      return { ...d };
    }
    const m = LIMITS.maxMarginMm;
    const page: DocumentPageSettings = {
      size: this.oneOf(v.size, 'page.size', Object.keys(PAGE_SIZES) as DocumentPageSettings['size'][], d.size),
      marginTop: this.number(v.marginTop, 'page.marginTop', 0, m, d.marginTop),
      marginRight: this.number(v.marginRight, 'page.marginRight', 0, m, d.marginRight),
      marginBottom: this.number(v.marginBottom, 'page.marginBottom', 0, m, d.marginBottom),
      marginLeft: this.number(v.marginLeft, 'page.marginLeft', 0, m, d.marginLeft),
      fontFamily: this.oneOf(v.fontFamily, 'page.fontFamily', FONT_FAMILIES, d.fontFamily),
      baseFontSize: this.number(v.baseFontSize, 'page.baseFontSize', LIMITS.minBaseFontSize, LIMITS.maxBaseFontSize, d.baseFontSize),
      textColor: this.optColor(v.textColor, 'page.textColor') ?? d.textColor,
      accentColor: this.optColor(v.accentColor, 'page.accentColor') ?? d.accentColor,
    };
    const bg = this.optColor(v.background, 'page.background');
    if (bg) page.background = bg;
    return page;
  }

  visibility(v: unknown): DocumentVisibility {
    const out = { ...DEFAULT_DOCUMENT_VISIBILITY };
    if (v === undefined) return out;
    if (!isObj(v)) {
      this.err('visibility', 'must be an object');
      return out;
    }
    for (const key of Object.keys(out) as (keyof DocumentVisibility)[]) {
      out[key] = this.bool(v[key], `visibility.${key}`, out[key]);
    }
    return out;
  }

  // -- style ---------------------------------------------------------------

  style(v: unknown, path: string): BlockStyle | undefined {
    if (v === undefined || v === null) return undefined;
    if (!isObj(v)) {
      this.err(path, 'must be an object');
      return undefined;
    }
    const s: BlockStyle = {};
    if (v.align !== undefined) s.align = this.oneOf(v.align, `${path}.align`, ['left', 'center', 'right'] as const, 'left');
    const color = this.optColor(v.color, `${path}.color`);
    if (color) s.color = color;
    const background = this.optColor(v.background, `${path}.background`);
    if (background) s.background = background;
    if (v.fontSize !== undefined) s.fontSize = this.number(v.fontSize, `${path}.fontSize`, LIMITS.minFontSize, LIMITS.maxFontSize, 12);
    if (v.fontWeight !== undefined) s.fontWeight = this.oneOf(v.fontWeight, `${path}.fontWeight`, ['normal', 'bold'] as const, 'normal');
    for (const k of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'] as const) {
      if (v[k] !== undefined) s[k] = this.number(v[k], `${path}.${k}`, 0, LIMITS.maxPadding, 0);
    }
    const borderColor = this.optColor(v.borderColor, `${path}.borderColor`);
    if (borderColor) s.borderColor = borderColor;
    if (v.borderWidth !== undefined) s.borderWidth = this.number(v.borderWidth, `${path}.borderWidth`, 0, LIMITS.maxBorderWidth, 0);
    if (v.borderRadius !== undefined) s.borderRadius = this.number(v.borderRadius, `${path}.borderRadius`, 0, LIMITS.maxBorderRadius, 0);
    return s;
  }

  // -- rich text -----------------------------------------------------------

  richText(v: unknown, path: string): RichTextNode {
    const empty: RichTextNode = { type: 'doc', content: [] };
    if (!isObj(v)) {
      this.err(path, 'must be a rich-text object');
      return empty;
    }
    const counter = { nodes: 0 };
    try {
      return this.richNode(v, 1, counter) ?? empty;
    } catch (e) {
      this.err(path, e instanceof RichTextLimitError ? e.message : 'invalid rich text');
      return empty;
    }
  }

  private richNode(v: unknown, depth: number, counter: { nodes: number }): RichTextNode | undefined {
    if (depth > LIMITS.maxRichTextDepth) {
      throw new RichTextLimitError(`rich text exceeds the maximum nesting depth of ${LIMITS.maxRichTextDepth}`);
    }
    if (++counter.nodes > LIMITS.maxRichTextNodes) {
      throw new RichTextLimitError(`rich text exceeds ${LIMITS.maxRichTextNodes} nodes`);
    }
    if (!isObj(v) || typeof v.type !== 'string' || !NODE_TYPES.has(v.type)) return undefined;
    const node: RichTextNode = { type: v.type };

    const attrs: Obj = {};
    const src = isObj(v.attrs) ? v.attrs : {};
    if (v.type === 'heading') {
      const level = Number(src.level);
      attrs.level = Number.isFinite(level) ? Math.min(3, Math.max(1, Math.round(level))) : 1;
    }
    if ((v.type === 'paragraph' || v.type === 'heading') && typeof src.textAlign === 'string' && TEXT_ALIGNS.has(src.textAlign)) {
      attrs.textAlign = src.textAlign;
    }
    if (v.type === 'mergeTag') {
      if (typeof src.path !== 'string' || !PATH_RE.test(src.path)) return undefined;
      attrs.path = src.path;
    }
    if (Object.keys(attrs).length) node.attrs = attrs;

    if (v.type === 'text') {
      if (typeof v.text !== 'string') return undefined;
      if (v.text.length > LIMITS.maxTextLength) {
        throw new RichTextLimitError(`text exceeds ${LIMITS.maxTextLength} characters`);
      }
      node.text = v.text;
    }

    if ((v.type === 'text' || v.type === 'mergeTag') && Array.isArray(v.marks)) {
      const marks: NonNullable<RichTextNode['marks']> = [];
      for (const m of v.marks.slice(0, 10)) {
        if (!isObj(m) || typeof m.type !== 'string' || !MARK_TYPES.has(m.type)) continue;
        const ma = isObj(m.attrs) ? m.attrs : {};
        if (m.type === 'textStyle') {
          const color = safeColor(ma.color);
          if (color) marks.push({ type: 'textStyle', attrs: { color } });
        } else if (m.type === 'link') {
          if (typeof ma.href === 'string' && ma.href.length <= 2000) marks.push({ type: 'link', attrs: { href: ma.href } });
        } else {
          marks.push({ type: m.type });
        }
      }
      if (marks.length) node.marks = marks;
    }

    if (Array.isArray(v.content) && v.type !== 'text' && v.type !== 'mergeTag' && v.type !== 'hardBreak') {
      node.content = v.content
        .map((c) => this.richNode(c, depth + 1, counter))
        .filter((c): c is RichTextNode => c !== undefined);
    }
    return node;
  }

  // -- blocks --------------------------------------------------------------

  block(v: unknown, path: string): DocumentBlock | undefined {
    if (!isObj(v)) {
      this.err(path, 'must be an object');
      return undefined;
    }
    if (typeof v.type !== 'string' || !BLOCK_TYPES.has(v.type)) {
      this.err(`${path}.type`, `unknown block type ${JSON.stringify(v.type ?? null)}`);
      return undefined;
    }
    const type = v.type as DocumentBlockType;
    const d = createBlock(type) as DocumentBlock & Obj;
    const out: Obj = { id: this.id(v.id, `${path}.id`), type };
    const style = this.style(v.style, `${path}.style`);
    if (style) out.style = style;
    const p = (k: string) => `${path}.${k}`;

    switch (type) {
      case 'text':
        out.content = v.content === undefined ? d.content : this.richText(v.content, p('content'));
        break;
      case 'image': {
        const assetId = this.optString(v.assetId, p('assetId'));
        if (assetId) out.assetId = assetId;
        out.widthPercent = this.number(v.widthPercent, p('widthPercent'), 10, 100, 100);
        const alt = this.optString(v.alt, p('alt'), 500);
        if (alt !== undefined) out.alt = alt;
        break;
      }
      case 'logo':
        out.maxHeight = this.number(v.maxHeight, p('maxHeight'), LIMITS.minLogoHeight, LIMITS.maxLogoHeight, 80);
        break;
      case 'divider':
        out.thickness = this.number(v.thickness, p('thickness'), 1, LIMITS.maxDividerThickness, 1);
        out.lineStyle = this.oneOf(v.lineStyle, p('lineStyle'), ['solid', 'dashed', 'dotted'] as const, 'solid');
        break;
      case 'spacer':
        out.height = this.number(v.height, p('height'), 0, LIMITS.maxSpacerHeight, 16);
        break;
      case 'table': {
        let rows: RichTextNode[][] = d.rows as RichTextNode[][];
        if (v.rows !== undefined) {
          if (!Array.isArray(v.rows)) {
            this.err(p('rows'), 'must be an array');
          } else if (v.rows.length > LIMITS.maxTableRows) {
            this.err(p('rows'), `at most ${LIMITS.maxTableRows} rows`);
          } else {
            rows = v.rows.map((r, i) => {
              const rp = `${p('rows')}[${i}]`;
              if (!Array.isArray(r)) {
                this.err(rp, 'must be an array');
                return [];
              }
              if (r.length > LIMITS.maxTableColumns) {
                this.err(rp, `at most ${LIMITS.maxTableColumns} cells`);
                return [];
              }
              return r.map((c, j) => this.richText(c, `${rp}[${j}]`));
            });
          }
        }
        out.rows = rows;
        out.headerRow = this.bool(v.headerRow, p('headerRow'), true);
        out.bordered = this.bool(v.bordered, p('bordered'), true);
        if (v.columnWidths !== undefined) {
          if (!Array.isArray(v.columnWidths) || v.columnWidths.length > LIMITS.maxTableColumns) {
            this.err(p('columnWidths'), `must be an array of at most ${LIMITS.maxTableColumns} numbers`);
          } else {
            out.columnWidths = v.columnWidths.map((w, i) => this.number(w, `${p('columnWidths')}[${i}]`, 1, 100, 10));
          }
        }
        break;
      }
      case 'field': {
        if (v.path === undefined) out.path = d.path;
        else if (typeof v.path !== 'string' || !PATH_RE.test(v.path)) {
          this.err(p('path'), 'must be a merge-tag path like "client.fullName"');
          out.path = d.path;
        } else out.path = v.path;
        const label = v.label === undefined ? d.label : this.optString(v.label, p('label'));
        if (label !== undefined) out.label = label;
        out.hideIfEmpty = this.bool(v.hideIfEmpty, p('hideIfEmpty'), false);
        break;
      }
      case 'itemsTable': {
        const defaults = (d as unknown as ItemsTableBlock).columns;
        let columns = defaults;
        if (v.columns !== undefined) {
          if (!Array.isArray(v.columns)) {
            this.err(p('columns'), 'must be an array');
          } else if (v.columns.length > ITEMS_TABLE_COLUMNS.length * 2) {
            this.err(p('columns'), `at most ${ITEMS_TABLE_COLUMNS.length} columns`);
          } else {
            const seen = new Set<string>();
            columns = [];
            v.columns.forEach((c, i) => {
              const cp = `${p('columns')}[${i}]`;
              if (!isObj(c)) return this.err(cp, 'must be an object');
              if (typeof c.key !== 'string' || !ITEM_COLUMNS.has(c.key)) {
                return this.err(`${cp}.key`, `unknown column ${JSON.stringify(c.key ?? null)}`);
              }
              if (seen.has(c.key)) return this.err(`${cp}.key`, `duplicate column "${c.key}"`);
              seen.add(c.key);
              const key = c.key as ItemsTableColumn;
              const label = this.optString(c.label, `${cp}.label`) ?? defaults.find((x) => x.key === key)?.label ?? key;
              columns.push({ key, label, visible: this.bool(c.visible, `${cp}.visible`, true) });
            });
          }
        }
        out.columns = columns;
        const hb = this.optColor(v.headerBackground, p('headerBackground'));
        if (hb) out.headerBackground = hb;
        const hc = this.optColor(v.headerColor, p('headerColor'));
        if (hc) out.headerColor = hc;
        out.striped = this.bool(v.striped, p('striped'), true);
        break;
      }
      case 'totals':
        for (const k of ['showSubtotal', 'showDiscount', 'showTax', 'showPaid', 'showBalance'] as const) {
          out[k] = this.bool(v[k], p(k), true);
        }
        {
          const label = v.totalLabel === undefined ? d.totalLabel : this.optString(v.totalLabel, p('totalLabel'));
          if (label !== undefined) out.totalLabel = label;
        }
        break;
      case 'signature':
        out.label = (v.label === undefined ? undefined : this.optString(v.label, p('label'))) ?? d.label;
        out.showDate = this.bool(v.showDate, p('showDate'), true);
        break;
      case 'notes': {
        const title = v.title === undefined ? d.title : this.optString(v.title, p('title'));
        if (title !== undefined) out.title = title;
        break;
      }
      case 'pageBreak':
        break;
    }
    return out as unknown as DocumentBlock;
  }

  // -- layout --------------------------------------------------------------

  column(v: unknown, path: string): { col: DocumentColumn; spanOk: boolean } | undefined {
    if (!isObj(v)) {
      this.err(path, 'must be an object');
      return undefined;
    }
    let spanOk = true;
    let span = 12;
    if (typeof v.span !== 'number' || !Number.isInteger(v.span) || v.span < 1 || v.span > 12) {
      this.err(`${path}.span`, 'must be an integer between 1 and 12');
      spanOk = false;
    } else span = v.span;

    let blocks: DocumentBlock[] = [];
    if (v.blocks !== undefined) {
      if (!Array.isArray(v.blocks)) this.err(`${path}.blocks`, 'must be an array');
      else if (v.blocks.length > LIMITS.maxBlocksPerColumn) {
        this.err(`${path}.blocks`, `at most ${LIMITS.maxBlocksPerColumn} blocks per column`);
      } else {
        blocks = v.blocks
          .map((b, i) => this.block(b, `${path}.blocks[${i}]`))
          .filter((b): b is DocumentBlock => b !== undefined);
      }
    }
    const col: DocumentColumn = { id: this.id(v.id, `${path}.id`), span, blocks };
    if (v.verticalAlign !== undefined) {
      col.verticalAlign = this.oneOf(v.verticalAlign, `${path}.verticalAlign`, ['top', 'middle', 'bottom'] as const, 'top');
    }
    return { col, spanOk };
  }

  row(v: unknown, path: string): DocumentRow | undefined {
    if (!isObj(v)) {
      this.err(path, 'must be an object');
      return undefined;
    }
    const row: DocumentRow = { id: this.id(v.id, `${path}.id`), columns: [] };
    const cp = `${path}.columns`;
    if (!Array.isArray(v.columns)) {
      this.err(cp, 'must be an array');
    } else if (v.columns.length === 0) {
      this.err(cp, 'a row needs at least one column');
    } else if (v.columns.length > LIMITS.maxColumnsPerRow) {
      this.err(cp, `at most ${LIMITS.maxColumnsPerRow} columns per row`);
    } else {
      const results = v.columns.map((c, i) => this.column(c, `${cp}[${i}]`));
      row.columns = results.filter((r) => r !== undefined).map((r) => r!.col);
      if (results.every((r) => r?.spanOk)) {
        const sum = row.columns.reduce((s, c) => s + c.span, 0);
        if (sum !== 12) this.err(cp, `column spans must sum to 12 (got ${sum})`);
      }
    }
    const style = this.style(v.style, `${path}.style`);
    if (style) row.style = style;
    if (v.gap !== undefined) row.gap = this.number(v.gap, `${path}.gap`, 0, LIMITS.maxRowGap, 16);
    return row;
  }

  section(v: unknown, name: 'header' | 'body' | 'footer'): DocumentRow[] {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) {
      this.err(name, 'must be an array of rows');
      return [];
    }
    if (v.length > LIMITS.maxRowsPerSection) {
      this.err(name, `at most ${LIMITS.maxRowsPerSection} rows per section`);
      return [];
    }
    return v.map((r, i) => this.row(r, `${name}[${i}]`)).filter((r): r is DocumentRow => r !== undefined);
  }
}

/**
 * Structural validation + normalisation of template content (no external
 * libs). Missing optional parts are filled with defaults, numbers are clamped,
 * unknown rich-text nodes/marks are stripped and unknown top-level keys are
 * dropped. Errors carry paths like `body[0].columns[1].span`.
 */
export function validateTemplateContent(content: unknown): ValidationResult {
  if (!isObj(content)) return { ok: false, errors: ['content: must be an object'] };
  const v = new Validator();
  const value: DocumentTemplateContent = {
    page: v.page(content.page),
    header: v.section(content.header, 'header'),
    body: v.section(content.body, 'body'),
    footer: v.section(content.footer, 'footer'),
    visibility: v.visibility(content.visibility),
  };
  return v.errors.length ? { ok: false, errors: v.errors } : { ok: true, value };
}
