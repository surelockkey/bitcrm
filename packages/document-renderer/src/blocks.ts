import type {
  BlockStyle,
  DocumentBlock,
  DocumentRenderContext,
  DocumentTemplateContent,
  DocumentVisibility,
  ItemsTableBlock,
  ItemsTableColumn,
  TotalsBlock,
} from '@bitcrm/types';
import { DEFAULT_DOCUMENT_VISIBILITY } from '@bitcrm/types';
import { DEFAULT_ACCENT_COLOR, LIMITS } from './defaults';
import { clampNumber, escapeHtml, num, safeColor, safeUrl } from './escape';
import { interpolate, resolveMergeTag } from './merge-tags';
import { formatMoney, formatPercent } from './money';
import { renderRichText } from './rich-text';

export type RenderMode = 'screen' | 'pdf';

export interface RenderOptions {
  /** `screen` (default): editor/preview paper. `pdf`: print CSS for headless Chromium. */
  mode?: RenderMode;
  /** Adds `data-*-id` attributes so the editor can map clicks to template nodes. */
  showBlockIds?: boolean;
}

const ALIGNS = new Set(['left', 'center', 'right']);

/** Converts a BlockStyle to validated inline CSS declarations. */
export function styleDeclarations(style: BlockStyle | undefined): string[] {
  if (!style || typeof style !== 'object') return [];
  const out: string[] = [];
  if (typeof style.align === 'string' && ALIGNS.has(style.align)) out.push(`text-align:${style.align}`);
  const color = safeColor(style.color);
  if (color) out.push(`color:${color}`);
  const bg = safeColor(style.background);
  if (bg) out.push(`background:${bg}`);
  if (style.fontSize !== undefined) {
    out.push(`font-size:${num(clampNumber(style.fontSize, LIMITS.minFontSize, LIMITS.maxFontSize, 12))}px`);
  }
  if (style.fontWeight === 'bold') out.push('font-weight:700');
  else if (style.fontWeight === 'normal') out.push('font-weight:400');
  for (const [key, prop] of [
    ['paddingTop', 'padding-top'],
    ['paddingRight', 'padding-right'],
    ['paddingBottom', 'padding-bottom'],
    ['paddingLeft', 'padding-left'],
  ] as const) {
    if (style[key] !== undefined) out.push(`${prop}:${num(clampNumber(style[key], 0, LIMITS.maxPadding, 0))}px`);
  }
  const bw = clampNumber(style.borderWidth, 0, LIMITS.maxBorderWidth, 0);
  if (bw > 0) out.push(`border:${num(bw)}px solid ${safeColor(style.borderColor) ?? '#d1d5db'}`);
  if (style.borderRadius !== undefined) {
    out.push(`border-radius:${num(clampNumber(style.borderRadius, 0, LIMITS.maxBorderRadius, 0))}px`);
  }
  return out;
}

export function styleAttr(decls: string[]): string {
  return decls.length ? ` style="${escapeHtml(decls.join(';'))}"` : '';
}

function placeholder(label: string, extraClass = '', style = ''): string {
  return `<div class="placeholder${extraClass ? ` ${extraClass}` : ''}"${style ? ` style="${escapeHtml(style)}"` : ''}>${escapeHtml(label)}</div>`;
}

function visibilityOf(template: DocumentTemplateContent | undefined): DocumentVisibility {
  return { ...DEFAULT_DOCUMENT_VISIBILITY, ...(template?.visibility ?? {}) };
}

function accentOf(template: DocumentTemplateContent | undefined): string {
  return safeColor(template?.page?.accentColor) ?? DEFAULT_ACCENT_COLOR;
}

function multiline(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, '<br>');
}

function formatQuantity(q: number): string {
  if (typeof q !== 'number' || !Number.isFinite(q)) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(q);
}

const COLUMN_GATES: Record<ItemsTableColumn, keyof DocumentVisibility | null> = {
  name: null,
  description: 'description',
  sku: 'sku',
  quantity: 'quantity',
  unitPrice: 'unitPrice',
  taxable: 'taxableMark',
  amount: 'lineAmount',
};

const NUMERIC_COLUMNS = new Set<ItemsTableColumn>(['quantity', 'unitPrice', 'amount']);

function renderItemsTable(
  block: ItemsTableBlock,
  ctx: DocumentRenderContext,
  template: DocumentTemplateContent | undefined,
  mode: RenderMode,
): string {
  const vis = visibilityOf(template);
  const configured = Array.isArray(block.columns) ? block.columns : [];
  const isShown = (key: ItemsTableColumn, visible: boolean) => {
    const gate = COLUMN_GATES[key];
    return visible !== false && (gate === null || vis[gate] !== false);
  };
  const descCol = configured.find((c) => c?.key === 'description');
  const showDescription = descCol ? isShown('description', descCol.visible) : vis.description !== false;
  const columns = configured.filter(
    (c) => c && c.key in COLUMN_GATES && c.key !== 'description' && isShown(c.key, c.visible),
  );

  const bg = safeColor(block.headerBackground) ?? accentOf(template);
  const fg = safeColor(block.headerColor) ?? '#ffffff';
  const head = columns
    .map((c) => `<th class="col-${c.key}${NUMERIC_COLUMNS.has(c.key) ? ' num' : ''}">${escapeHtml(c.label)}</th>`)
    .join('');

  const items = Array.isArray(ctx.items) ? ctx.items : [];
  const currency = ctx.currency;
  const cell = (key: ItemsTableColumn, item: DocumentRenderContext['items'][number]): string => {
    switch (key) {
      case 'name': {
        const desc = showDescription && item.description ? `<div class="item-desc">${escapeHtml(item.description)}</div>` : '';
        return `<div class="item-name">${escapeHtml(item.name)}</div>${desc}`;
      }
      case 'sku':
        return escapeHtml(item.sku ?? '');
      case 'quantity':
        return formatQuantity(item.quantity);
      case 'unitPrice':
        return escapeHtml(formatMoney(item.unitPrice, currency));
      case 'amount':
        return escapeHtml(formatMoney(item.amount, currency));
      case 'taxable':
        return item.taxable ? '<span class="tax-mark">&#10003;</span>' : '';
      default:
        return '';
    }
  };

  let bodyRows = items
    .map(
      (item) =>
        `<tr>${columns
          .map((c) => `<td class="col-${c.key}${NUMERIC_COLUMNS.has(c.key) ? ' num' : ''}">${cell(c.key, item)}</td>`)
          .join('')}</tr>`,
    )
    .join('');
  if (!items.length && mode === 'screen') {
    bodyRows = `<tr><td class="empty" colspan="${Math.max(1, columns.length)}">No items</td></tr>`;
  }

  const cls = `items${block.striped ? ' striped' : ''}`;
  return `<table class="${cls}"><thead><tr style="background:${bg};color:${fg}">${head}</tr></thead><tbody>${bodyRows}</tbody></table>`;
}

function renderTotals(block: TotalsBlock, ctx: DocumentRenderContext, template: DocumentTemplateContent | undefined): string {
  const vis = visibilityOf(template);
  const t = ctx.totals ?? { subtotal: 0, discount: 0, taxRatePercent: 0, tax: 0, total: 0, amountPaid: 0, balanceDue: 0 };
  const money = (n: number) => formatMoney(n, ctx.currency);
  const isEstimate = ctx.kind === 'estimate';
  const rows: [string, string, string][] = [];

  if (block.showSubtotal !== false) rows.push(['Subtotal', money(t.subtotal), 'subtotal']);
  if (block.showDiscount !== false && vis.discount !== false && t.discount > 0) {
    rows.push(['Discount', money(-t.discount), 'discount']);
  }
  if (block.showTax !== false && vis.tax !== false && t.tax > 0) {
    const name = t.taxRateName?.trim();
    const pct = formatPercent(t.taxRatePercent);
    rows.push([`Tax (${name ? `${name} ` : ''}${pct})`, money(t.tax), 'tax']);
  }
  const totalLabel = typeof block.totalLabel === 'string' && block.totalLabel.trim() ? interpolate(block.totalLabel, ctx) : 'Total';
  rows.push([totalLabel, money(t.total), 'total']);
  if (!isEstimate && block.showPaid !== false && vis.payments !== false && t.amountPaid > 0) {
    rows.push(['Paid', money(-t.amountPaid), 'paid']);
  }
  if (!isEstimate && block.showBalance !== false && vis.balance !== false) {
    rows.push(['Balance due', money(t.balanceDue), 'balance']);
  }

  return `<table class="totals"><tbody>${rows
    .map(
      ([label, value, cls]) =>
        `<tr class="t-${cls}"><td class="t-label">${escapeHtml(label)}</td><td class="t-value">${escapeHtml(value)}</td></tr>`,
    )
    .join('')}</tbody></table>`;
}

function renderInner(
  block: DocumentBlock,
  ctx: DocumentRenderContext,
  template: DocumentTemplateContent | undefined,
  mode: RenderMode,
): string | null {
  switch (block.type) {
    case 'text':
      return `<div class="rt">${renderRichText(block.content, ctx)}</div>`;

    case 'image': {
      const src = block.assetId ? safeUrl(ctx.assets?.[block.assetId], 'image') : undefined;
      if (!src) return mode === 'screen' ? placeholder('Image', 'img-ph') : null;
      const width = num(clampNumber(block.widthPercent, 10, 100, 100));
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(block.alt ?? '')}" class="img" style="width:${width}%">`;
    }

    case 'logo': {
      const maxHeight = num(clampNumber(block.maxHeight, LIMITS.minLogoHeight, LIMITS.maxLogoHeight, 80));
      const src = safeUrl(ctx.business?.logoUrl, 'image');
      if (!src) return mode === 'screen' ? placeholder('Logo', 'logo-ph', `height:${maxHeight}px`) : null;
      return `<img src="${escapeHtml(src)}" alt="${escapeHtml(ctx.business?.name ?? 'Logo')}" class="logo" style="max-height:${maxHeight}px">`;
    }

    case 'divider': {
      const thickness = num(clampNumber(block.thickness, 1, LIMITS.maxDividerThickness, 1));
      const lineStyle = ['solid', 'dashed', 'dotted'].includes(block.lineStyle) ? block.lineStyle : 'solid';
      const color = safeColor(block.style?.color) ?? 'var(--border)';
      return `<hr style="border-top:${thickness}px ${lineStyle} ${color}">`;
    }

    case 'spacer':
      return `<div style="height:${num(clampNumber(block.height, 0, LIMITS.maxSpacerHeight, 16))}px"></div>`;

    case 'table': {
      const rows = (Array.isArray(block.rows) ? block.rows : []).slice(0, LIMITS.maxTableRows).map((r) =>
        (Array.isArray(r) ? r : []).slice(0, LIMITS.maxTableColumns),
      );
      const widths = Array.isArray(block.columnWidths)
        ? `<colgroup>${block.columnWidths
            .slice(0, LIMITS.maxTableColumns)
            .map((w) => `<col style="width:${num(clampNumber(w, 1, 100, 10))}%">`)
            .join('')}</colgroup>`
        : '';
      const renderRow = (cells: unknown[], tag: 'td' | 'th') =>
        `<tr>${cells.map((c) => `<${tag}>${renderRichText(c, ctx)}</${tag}>`).join('')}</tr>`;
      const [first, ...rest] = rows;
      const head = block.headerRow && first ? `<thead>${renderRow(first, 'th')}</thead>` : '';
      const bodyRows = (block.headerRow ? rest : rows).map((r) => renderRow(r, 'td')).join('');
      return `<table class="tbl${block.bordered ? ' bordered' : ''}">${widths}${head}<tbody>${bodyRows}</tbody></table>`;
    }

    case 'field': {
      const value = resolveMergeTag(block.path, ctx);
      if (block.hideIfEmpty && !value.trim()) return null;
      const label = block.label ? `<span class="field-label">${escapeHtml(block.label)}</span>` : '';
      return `<div class="field">${label}<span class="field-value">${multiline(value)}</span></div>`;
    }

    case 'itemsTable':
      return renderItemsTable(block, ctx, template, mode);

    case 'totals':
      return renderTotals(block, ctx, template);

    case 'signature': {
      const sig = ctx.signature;
      const src = safeUrl(sig?.imageUrl, 'image');
      const img = src ? `<img src="${escapeHtml(src)}" alt="Signature" class="sig-img">` : '';
      const name = sig?.signedBy ? `<span class="sig-name">${escapeHtml(sig.signedBy)}</span>` : '';
      const date = block.showDate
        ? `<div class="sig-date">Date: ${sig?.signedAt ? escapeHtml(sig.signedAt) : '<span class="date-line"></span>'}</div>`
        : '';
      return `<div class="sig">${img}<div class="sig-line"></div><div class="sig-meta"><span class="sig-label">${escapeHtml(
        interpolate(block.label ?? '', ctx),
      )}</span>${name}</div>${date}</div>`;
    }

    case 'notes': {
      const notes = (ctx.document?.notes ?? '').trim();
      const title = block.title?.trim() ? `<div class="notes-title">${escapeHtml(interpolate(block.title, ctx))}</div>` : '';
      if (!notes) return mode === 'screen' ? `${title}${placeholder('Document notes appear here', 'notes-ph')}` : null;
      return `${title}<div class="notes-body">${multiline(notes)}</div>`;
    }

    case 'pageBreak':
      return mode === 'screen' ? '<div class="page-break"><span>Page break</span></div>' : '<div class="page-break"></div>';

    default:
      return null;
  }
}

/** Renders a single block (wrapper + content). Returns `''` for hidden/unknown blocks. */
export function renderBlockHtml(
  block: DocumentBlock,
  ctx: DocumentRenderContext,
  template: DocumentTemplateContent,
  opts: RenderOptions = {},
): string {
  if (!block || typeof block !== 'object') return '';
  const mode: RenderMode = opts.mode === 'pdf' ? 'pdf' : 'screen';
  let inner: string | null;
  try {
    inner = renderInner(block, ctx, template, mode);
  } catch {
    inner = mode === 'screen' ? placeholder('This block could not be rendered') : null;
  }
  if (inner === null) return '';
  const type = typeof block.type === 'string' ? block.type.replace(/[^A-Za-z]/g, '') : '';
  const idAttr = opts.showBlockIds ? ` data-block-id="${escapeHtml(block.id)}"` : '';
  return `<div class="blk blk-${type}"${idAttr}${styleAttr(styleDeclarations(block.style))}>${inner}</div>`;
}
