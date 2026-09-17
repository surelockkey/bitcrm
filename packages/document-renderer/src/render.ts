import type { DocumentPageSettings, DocumentRenderContext, DocumentRow, DocumentTemplateContent } from '@bitcrm/types';
import { renderBlockHtml, styleAttr, styleDeclarations, type RenderMode, type RenderOptions } from './blocks';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PAGE_SETTINGS,
  DEFAULT_ROW_GAP,
  DEFAULT_TEXT_COLOR,
  FONT_STACKS,
  LIMITS,
  PAGE_SIZES,
  WEB_FONT_URLS,
} from './defaults';
import { clampNumber, escapeHtml, num, safeColor } from './escape';

type Section = 'header' | 'body' | 'footer';

const V_ALIGN: Record<string, string> = { top: 'start', middle: 'center', bottom: 'end' };

interface Page {
  size: DocumentPageSettings['size'];
  margins: [string, string, string, string];
  fontFamily: DocumentPageSettings['fontFamily'];
  fontStack: string;
  baseFontSize: string;
  textColor: string;
  accentColor: string;
  background: string;
}

function resolvePage(raw: Partial<DocumentPageSettings> | undefined): Page {
  const p = { ...DEFAULT_PAGE_SETTINGS, ...(raw ?? {}) };
  const size = p.size in PAGE_SIZES ? p.size : 'letter';
  const fontFamily = Object.prototype.hasOwnProperty.call(FONT_STACKS, p.fontFamily) ? p.fontFamily : DEFAULT_PAGE_SETTINGS.fontFamily;
  const mm = (v: unknown, d: number) => `${num(clampNumber(v, 0, LIMITS.maxMarginMm, d))}mm`;
  return {
    size,
    margins: [
      mm(p.marginTop, DEFAULT_PAGE_SETTINGS.marginTop),
      mm(p.marginRight, DEFAULT_PAGE_SETTINGS.marginRight),
      mm(p.marginBottom, DEFAULT_PAGE_SETTINGS.marginBottom),
      mm(p.marginLeft, DEFAULT_PAGE_SETTINGS.marginLeft),
    ],
    fontFamily,
    fontStack: FONT_STACKS[fontFamily],
    baseFontSize: num(clampNumber(p.baseFontSize, LIMITS.minBaseFontSize, LIMITS.maxBaseFontSize, DEFAULT_PAGE_SETTINGS.baseFontSize)),
    textColor: safeColor(p.textColor) ?? DEFAULT_TEXT_COLOR,
    accentColor: safeColor(p.accentColor) ?? DEFAULT_ACCENT_COLOR,
    background: safeColor(p.background) ?? '#ffffff',
  };
}

function renderRow(
  row: DocumentRow,
  section: Section,
  ctx: DocumentRenderContext,
  template: DocumentTemplateContent,
  opts: RenderOptions,
): string {
  if (!row || typeof row !== 'object') return '';
  const columns = (Array.isArray(row.columns) ? row.columns : []).slice(0, LIMITS.maxColumnsPerRow);
  const hasBreak = columns.some((c) => Array.isArray(c?.blocks) && c.blocks.some((b) => b?.type === 'pageBreak'));
  const decls = [`column-gap:${num(clampNumber(row.gap, 0, LIMITS.maxRowGap, DEFAULT_ROW_GAP))}px`, ...styleDeclarations(row.style)];
  const rowId = opts.showBlockIds ? ` data-row-id="${escapeHtml(row.id)}"` : '';
  const cols = columns
    .map((col) => {
      if (!col || typeof col !== 'object') return '';
      const span = Math.round(clampNumber(col.span, 1, 12, 12));
      const colDecls = [`grid-column:span ${span}`];
      const align = col.verticalAlign ? V_ALIGN[col.verticalAlign] : undefined;
      if (align) colDecls.push(`align-self:${align}`);
      const colId = opts.showBlockIds ? ` data-column-id="${escapeHtml(col.id)}"` : '';
      const blocks = (Array.isArray(col.blocks) ? col.blocks : [])
        .slice(0, LIMITS.maxBlocksPerColumn)
        .map((b) => renderBlockHtml(b, ctx, template, opts))
        .join('');
      return `<div class="col"${colId}${styleAttr(colDecls)}>${blocks}</div>`;
    })
    .join('');
  return `<div class="row${hasBreak ? ' row-break' : ''}"${rowId}${styleAttr(decls)}>${cols}</div>`;
}

function renderSection(
  rows: DocumentRow[] | undefined,
  section: Section,
  ctx: DocumentRenderContext,
  template: DocumentTemplateContent,
  opts: RenderOptions,
): string {
  if (!Array.isArray(rows)) return '';
  return rows
    .slice(0, LIMITS.maxRowsPerSection)
    .map((r) => renderRow(r, section, ctx, template, opts))
    .join('\n');
}

const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html,body{margin:0;padding:0}
body{-webkit-print-color-adjust: exact;print-color-adjust: exact;line-height:1.45;-webkit-font-smoothing:antialiased;word-wrap:break-word}
img{max-width:100%}
.row{display:grid;grid-template-columns:repeat(12, minmax(0, 1fr));align-items:start}
.col{min-width:0}
.blk{min-width:0}
.blk + .blk{margin-top:6px}
p{margin:0 0 .35em}
h1,h2,h3{margin:0 0 .3em;line-height:1.2}
h1{font-size:2.2em;font-weight:800}
h2{font-size:1.6em;font-weight:700}
h3{font-size:1.2em;font-weight:700}
.rt>:last-child,.rt li>:last-child{margin-bottom:0}
ul,ol{margin:0 0 .35em;padding-left:1.4em}
a{color:var(--accent)}
hr{border:0;margin:4px 0;height:0}
.img,.logo{display:inline-block;vertical-align:top;height:auto}
.logo{width:auto;max-width:100%}
.tbl{width:100%;border-collapse:collapse}
.tbl th,.tbl td{padding:4px 6px;text-align:left;vertical-align:top}
.tbl th{font-weight:700}
.tbl p{margin:0}
.tbl.bordered th,.tbl.bordered td{border:1px solid var(--border)}
.field{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.field-label{color:var(--muted)}
.field-value{font-weight:600;text-align:right;margin-left:auto}
.items{width:100%;border-collapse:collapse}
.items thead{display:table-header-group}
.items tr{break-inside:avoid;page-break-inside:avoid}
.items th{padding:6px 8px;text-align:left;font-weight:600;font-size:.92em;white-space:nowrap}
.items td{padding:7px 8px;border-bottom:1px solid var(--border);vertical-align:top}
.items .num{text-align:right;white-space:nowrap}
.items .col-taxable{text-align:center;width:1%}
.items.striped tbody tr:nth-child(even) td{background:#f6f6f7;box-shadow:1px 0 0 #f6f6f7}
.items td.empty{text-align:center;color:var(--muted);padding:16px}
.item-name{font-weight:600}
.item-desc{color:var(--muted);font-size:.9em;margin-top:2px;white-space:pre-line}
.tax-mark{color:var(--accent);font-weight:700}
.totals{width:100%;border-collapse:collapse;break-inside:avoid;page-break-inside:avoid}
.totals td{padding:4px 8px}
.totals .t-value{text-align:right;white-space:nowrap}
.totals .t-label{color:var(--muted)}
.totals .t-total td{font-weight:800;font-size:1.15em;color:inherit;border-top:2px solid var(--accent);padding-top:7px}
.totals .t-balance td{font-weight:700;color:var(--accent)}
.sig{break-inside:avoid;page-break-inside:avoid;padding-top:8px}
.sig-img{display:block;max-height:64px;max-width:100%}
.sig-line{border-bottom:1px solid currentColor;height:40px;opacity:.7}
.sig-img + .sig-line{height:4px}
.sig-meta{display:flex;justify-content:space-between;gap:8px;margin-top:4px;color:var(--muted);font-size:.9em}
.sig-name{color:var(--text)}
.sig-date{margin-top:10px;color:var(--muted);font-size:.9em}
.date-line{display:inline-block;width:120px;border-bottom:1px solid currentColor;vertical-align:bottom}
.notes-title{font-weight:700;margin-bottom:4px;color:var(--accent)}
.notes-body{color:var(--text)}
.doc-footer{color:var(--muted)}
`;

const SCREEN_CSS = `
html{background:#e5e7eb}
body{padding:24px 16px}
.paper{margin:0 auto;box-shadow:0 1px 3px rgba(0,0,0,0.12),0 12px 32px rgba(0,0,0,0.10);display:flex;flex-direction:column;border-radius:2px}
.doc-body{flex:1 0 auto}
.doc-header,.doc-body{padding-bottom:12px}
.doc-footer{padding-top:12px}
.placeholder{border:1px dashed #cbd5e1;background:#f8fafc;color:#94a3b8;display:flex;align-items:center;justify-content:center;padding:10px;font-size:11px;border-radius:4px;min-height:32px;text-align:center}
.logo-ph{width:160px;max-width:100%}
.img-ph{min-height:80px}
.page-break{border-top:1px dashed #94a3b8;margin:14px 0;height:0;text-align:center}
.page-break span{position:relative;top:-0.75em;background:#ffffff;padding:0 6px;color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.06em}
`;

const PDF_CSS = `
.doc-layout{width:100%;border-collapse:collapse;border-spacing:0}
.doc-layout > thead{display: table-header-group}
.doc-layout > tfoot{display: table-footer-group}
.doc-layout > thead > tr > td,.doc-layout > tfoot > tr > td,.doc-layout > tbody > tr > td{padding:0;vertical-align:top}
.doc-layout > thead > tr > td{padding-bottom:4mm}
.doc-layout > tfoot > tr > td{padding-top:4mm}
.page-break{break-after: page;page-break-after:always;height:0}
.row-break{break-after: page;page-break-after:always}
`;

const KIND_TITLES: Record<string, string> = { invoice: 'Invoice', estimate: 'Estimate', custom: 'Document' };

/** Renders a template against a context to a complete, self-contained HTML document. */
export function renderDocumentHtml(
  template: DocumentTemplateContent,
  ctx: DocumentRenderContext,
  opts: RenderOptions = {},
): string {
  const mode: RenderMode = opts.mode === 'pdf' ? 'pdf' : 'screen';
  const o: RenderOptions = { mode, showBlockIds: !!opts.showBlockIds };
  const tpl = (template ?? {}) as DocumentTemplateContent;
  const page = resolvePage(tpl.page);
  const dims = PAGE_SIZES[page.size];

  const header = renderSection(tpl.header, 'header', ctx, tpl, o);
  const body = renderSection(tpl.body, 'body', ctx, tpl, o);
  const footer = renderSection(tpl.footer, 'footer', ctx, tpl, o);

  const vars = `:root{--accent:${page.accentColor};--text:${page.textColor};--muted:#6b7280;--border:#e5e7eb}`;
  const bodyCss = `body{font-family:${page.fontStack};font-size:${page.baseFontSize}px;color:${page.textColor}}`;
  let modeCss: string;
  if (mode === 'screen') {
    modeCss = `${SCREEN_CSS}.paper{width:${dims.width};max-width:100%;min-height:${dims.height};padding:${page.margins.join(' ')};background:${page.background}}`;
  } else {
    modeCss = `@page { size: ${dims.css}; margin: ${page.margins.join(' ')}; }\n${PDF_CSS}html,body{background:${page.background}}`;
  }

  const fontUrl = mode === 'screen' ? WEB_FONT_URLS[page.fontFamily] : undefined;
  const fontLink = fontUrl ? `<link rel="stylesheet" href="${escapeHtml(fontUrl)}">\n` : '';

  const title = `${KIND_TITLES[ctx?.kind] ?? 'Document'}${ctx?.document?.number ? ` ${ctx.document.number}` : ''}`;
  const head = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${fontLink}<style>
${vars}
${bodyCss}
${BASE_CSS}
${modeCss}
</style>
</head>
<body>
`;

  let content: string;
  if (mode === 'screen') {
    content = `<div class="paper">
<div class="doc-header" data-section="header">${header}</div>
<div class="doc-body" data-section="body">${body}</div>
<div class="doc-footer" data-section="footer">${footer}</div>
</div>`;
  } else {
    const thead = header ? `<thead><tr><td><div class="doc-header" data-section="header">${header}</div></td></tr></thead>\n` : '';
    const tfoot = footer ? `<tfoot><tr><td><div class="doc-footer" data-section="footer">${footer}</div></td></tr></tfoot>\n` : '';
    content = `<table class="doc-layout">
${thead}${tfoot}<tbody><tr><td><div class="doc-body" data-section="body">${body}</div></td></tr></tbody>
</table>`;
  }

  return `${head}${content}\n</body>\n</html>\n`;
}
