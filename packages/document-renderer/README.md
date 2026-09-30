# @bitcrm/document-renderer

This package turns BitCRM document templates (rows → columns (span/12) → blocks) into one self-contained HTML document.
It is plain TypeScript with no DOM or React and no runtime dependencies except `@bitcrm/types`. Two places use it:

- **Web editor preview:** `renderDocumentHtml(content, sampleRenderContext(kind), { showBlockIds: true })`, put in an `<iframe srcdoc>`.
- **Billing PDF pipeline:** `renderDocumentHtml(content, ctx, { mode: 'pdf' })`, then Chromium `page.pdf({ preferCSSPageSize: true, printBackground: true })`.

## API

```ts
renderDocumentHtml(template, ctx, opts?: { mode?: 'screen' | 'pdf'; showBlockIds?: boolean }): string
renderBlockHtml(block, ctx, template, opts?): string
MERGE_TAGS / MERGE_TAG_GROUPS / resolveMergeTag(path, ctx) / interpolate(text, ctx)
DOCUMENT_PRESETS / createTemplateContent(kind, presetId?) / createBlock(type) / createRow(spans) / newId()
sampleRenderContext(kind)
validateTemplateContent(content): { ok: true; value } | { ok: false; errors: string[] }
formatMoney(n, currency = 'USD')
// extras: escapeHtml, safeColor, safeUrl, formatPercent, LIMITS, DEFAULT_PAGE_SETTINGS, FONT_STACKS, PAGE_SIZES
```

## Rules

- **Escaping:** all text is escaped.
  - Rich text is rendered from an allow-list of nodes: doc, paragraph, heading 1-3, text, hardBreak, bullet and ordered lists, listItem and mergeTag.
  - Allowed marks are bold, italic, underline, `textStyle.color` and `link`.
  - Links must be `http(s)` or `mailto`. Images must be `http(s)`, `blob:` or a raster `data:image/*` URI (no SVG).
  - Colors must be hex, `rgb()`/`rgba()` or a safe named color. Numbers are clamped.
- **Merge tags:** write them as `{{path}}` in text, or as `mergeTag` nodes.
  - Only paths listed in `MERGE_TAGS` resolve, plus `job.customFields.<key>`. `invoice.*` and `estimate.*` are aliases for `document.*`.
  - A missing value becomes `''`.
  - If every merge tag in a paragraph or heading resolves to empty, the whole line is dropped. This way, optional address lines don't leave blank lines.
- **Visibility:** `template.visibility` hides item-table columns (quantity, unitPrice, lineAmount, description, sku, taxableMark) and totals rows (discount, tax, payments, balance).
  - The discount and tax rows are also hidden when their amount is 0. The paid row is hidden when nothing has been paid.
  - Estimates never show the paid or balance rows.
- **PDF mode:**
  - `@page { size; margin }` is set from the page settings.
  - Header and footer rows repeat on every page because they sit in the `<thead>`/`<tfoot>` of a layout table.
  - The document makes no network requests: it uses local font fallbacks only.
  - Limitation: on the last page, the footer follows the content instead of sitting at the bottom of the page.
  - Empty notes, a missing logo and missing images render nothing. In screen mode they render placeholders instead.
- **Validation:** `validateTemplateContent` fills in defaults and removes unknown rich-text nodes and unknown top-level keys. It returns errors with paths, such as `body[0].columns: column spans must sum to 12 (got 11)`. Limits are in `LIMITS`:
  - at most 100 rows per section
  - at most 4 columns per row
  - at most 50 blocks per column
  - rich-text depth of at most 16
  - at most 20k characters per text node
  - tables of at most 50×10 cells

## Develop

```sh
npm run build -w @bitcrm/document-renderer   # tsc -p tsconfig.build.json → dist (build @bitcrm/types first)
cd packages/document-renderer && npm test    # jest + ts-jest, borrowed from backend/node_modules
npm run test:update                          # refresh preset snapshots after intentional changes
```
