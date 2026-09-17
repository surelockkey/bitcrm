import { DEFAULT_DOCUMENT_VISIBILITY, DOCUMENT_TEMPLATE_KINDS } from '@bitcrm/types';
import { LIMITS, createBlock, createRow, createTemplateContent, validateTemplateContent } from '../src';
import { emptyTemplate } from './helpers';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function errorsOf(input: unknown): string[] {
  const r = validateTemplateContent(input);
  return r.ok ? [] : r.errors;
}

describe('validateTemplateContent', () => {
  it('accepts every preset for every kind', () => {
    for (const kind of DOCUMENT_TEMPLATE_KINDS) {
      for (const preset of ['classic', 'modern', 'minimal']) {
        const r = validateTemplateContent(createTemplateContent(kind, preset));
        if (!r.ok) throw new Error(`${kind}/${preset}: ${r.errors.join('; ')}`);
      }
    }
  });

  it('is idempotent on valid content', () => {
    const c = createTemplateContent('invoice', 'classic');
    const r = validateTemplateContent(clone(c));
    expect(r.ok && r.value).toEqual(c);
  });

  it('rejects non-objects', () => {
    expect(errorsOf(null)).toEqual(['content: must be an object']);
    expect(errorsOf('x').length).toBe(1);
    expect(errorsOf([]).length).toBe(1);
  });

  it('fills defaults for missing optional parts', () => {
    const r = validateTemplateContent({});
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.header).toEqual([]);
    expect(r.value.body).toEqual([]);
    expect(r.value.footer).toEqual([]);
    expect(r.value.visibility).toEqual(DEFAULT_DOCUMENT_VISIBILITY);
    expect(r.value.page.size).toBe('letter');
    expect(r.value.page.fontFamily).toBeTruthy();
  });

  it('fills partial visibility and block defaults, generates missing ids', () => {
    const r = validateTemplateContent({
      visibility: { sku: true },
      body: [{ columns: [{ span: 12, blocks: [{ type: 'image' }, { type: 'totals', showTax: false }] }] }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.visibility).toEqual({ ...DEFAULT_DOCUMENT_VISIBILITY, sku: true });
    const row = r.value.body[0];
    expect(row.id).toBeTruthy();
    expect(row.columns[0].id).toBeTruthy();
    const [img, totals] = row.columns[0].blocks;
    expect(img.id).toBeTruthy();
    expect(img.type === 'image' && img.widthPercent).toBe(100);
    expect(totals.type === 'totals' && totals.showTax).toBe(false);
    expect(totals.type === 'totals' && totals.showSubtotal).toBe(true);
  });

  it('strips unknown top-level keys', () => {
    const r = validateTemplateContent({ ...emptyTemplate(), id: 'x', version: 3, evil: true });
    expect(r.ok && Object.keys(r.value).sort()).toEqual(['body', 'footer', 'header', 'page', 'visibility']);
  });

  it('requires spans to sum to 12', () => {
    const tpl = emptyTemplate();
    const row = createRow([6, 6]);
    row.columns[1].span = 5;
    tpl.body = [row];
    expect(errorsOf(tpl)).toEqual([expect.stringContaining('body[0].columns')]);
    expect(errorsOf(tpl)[0]).toContain('12');
  });

  it('rejects invalid spans and empty rows', () => {
    const tpl = emptyTemplate();
    tpl.header = [
      { id: 'r', columns: [{ id: 'c', span: 0, blocks: [] }, { id: 'd', span: 12, blocks: [] }] },
      { id: 'r2', columns: [] },
    ];
    const errs = errorsOf(tpl);
    expect(errs.some((e) => e.startsWith('header[0].columns[0].span'))).toBe(true);
    expect(errs.some((e) => e.startsWith('header[1].columns'))).toBe(true);
  });

  it('rejects unknown block types with a path', () => {
    const tpl = emptyTemplate();
    const row = createRow([12]);
    row.columns[0].blocks = [createBlock('text'), { id: 'x', type: 'video' } as never];
    tpl.footer = [row];
    expect(errorsOf(tpl)).toEqual([expect.stringMatching(/^footer\[0\]\.columns\[0\]\.blocks\[1\]\.type/)]);
  });

  it(`limits rows per section to ${100}`, () => {
    expect(LIMITS.maxRowsPerSection).toBe(100);
    const tpl = emptyTemplate();
    tpl.body = Array.from({ length: 101 }, () => createRow([12]));
    expect(errorsOf(tpl)).toEqual([expect.stringMatching(/^body: .*100/)]);
    tpl.body = tpl.body.slice(0, 100);
    expect(errorsOf(tpl)).toEqual([]);
  });

  it('limits columns per row to 4', () => {
    expect(LIMITS.maxColumnsPerRow).toBe(4);
    const tpl = emptyTemplate();
    tpl.body = [
      {
        id: 'r',
        columns: [2, 2, 2, 2, 4].map((span, i) => ({ id: `c${i}`, span, blocks: [] })),
      },
    ];
    expect(errorsOf(tpl).some((e) => e.startsWith('body[0].columns') && e.includes('4'))).toBe(true);
  });

  it('limits blocks per column to 50', () => {
    expect(LIMITS.maxBlocksPerColumn).toBe(50);
    const tpl = emptyTemplate();
    const row = createRow([12]);
    row.columns[0].blocks = Array.from({ length: 51 }, () => createBlock('spacer'));
    tpl.body = [row];
    expect(errorsOf(tpl)).toEqual([expect.stringMatching(/^body\[0\]\.columns\[0\]\.blocks: .*50/)]);
  });

  it('limits rich text depth', () => {
    let node: { type: string; content?: unknown[] } = { type: 'paragraph' };
    for (let i = 0; i < LIMITS.maxRichTextDepth + 2; i++) node = { type: 'bulletList', content: [{ type: 'listItem', content: [node] }] };
    const tpl = emptyTemplate();
    const row = createRow([12]);
    row.columns[0].blocks = [{ ...createBlock('text'), content: { type: 'doc', content: [node] } } as never];
    tpl.body = [row];
    expect(errorsOf(tpl)).toEqual([expect.stringMatching(/^body\[0\]\.columns\[0\]\.blocks\[0\]\.content.*depth/)]);
  });

  it('rejects oversized text', () => {
    const tpl = emptyTemplate();
    const row = createRow([12]);
    row.columns[0].blocks = [
      { ...createBlock('text'), content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x'.repeat(LIMITS.maxTextLength + 1) }] }] } },
    ];
    tpl.body = [row];
    expect(errorsOf(tpl).length).toBe(1);
  });

  it('strips unknown rich-text nodes and marks', () => {
    const tpl = emptyTemplate();
    const row = createRow([12]);
    row.columns[0].blocks = [
      {
        ...createBlock('text'),
        content: {
          type: 'doc',
          content: [
            { type: 'iframe' },
            { type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'bold' }, { type: 'evil' }] }] },
          ],
        },
      },
    ];
    tpl.body = [row];
    const r = validateTemplateContent(tpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.value.body[0].columns[0].blocks[0];
    expect(b.type === 'text' && b.content).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a', marks: [{ type: 'bold' }] }] }],
    });
  });

  it('validates page settings', () => {
    const tpl = emptyTemplate() as unknown as { page: Record<string, unknown> };
    tpl.page.size = 'tabloid';
    tpl.page.fontFamily = 'Comic Sans';
    tpl.page.accentColor = 'red;x';
    tpl.page.marginTop = 'a';
    const errs = errorsOf(tpl);
    expect(errs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^page\.size/),
        expect.stringMatching(/^page\.fontFamily/),
        expect.stringMatching(/^page\.accentColor/),
        expect.stringMatching(/^page\.marginTop/),
      ]),
    );
  });

  it('clamps numeric values instead of failing', () => {
    const tpl = emptyTemplate();
    tpl.page.marginTop = 999;
    const row = createRow([12]);
    row.columns[0].blocks = [{ ...createBlock('spacer'), height: 99999 }, { ...createBlock('image'), widthPercent: 1 }];
    tpl.body = [row];
    const r = validateTemplateContent(tpl);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.page.marginTop).toBe(LIMITS.maxMarginMm);
    const [sp, img] = r.value.body[0].columns[0].blocks;
    expect(sp.type === 'spacer' && sp.height).toBe(LIMITS.maxSpacerHeight);
    expect(img.type === 'image' && img.widthPercent).toBe(10);
  });

  it('validates style colors and block field types', () => {
    const tpl = emptyTemplate();
    const row = createRow([12]);
    row.columns[0].blocks = [
      { ...createBlock('divider'), style: { color: 'url(x)' } },
      { ...createBlock('field'), path: 'a b;c' },
      { ...createBlock('signature'), showDate: 'yes' as never },
      { ...createBlock('divider'), lineStyle: 'wavy' as never },
    ];
    tpl.body = [row];
    const errs = errorsOf(tpl);
    expect(errs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/blocks\[0\]\.style\.color/),
        expect.stringMatching(/blocks\[1\]\.path/),
        expect.stringMatching(/blocks\[2\]\.showDate/),
        expect.stringMatching(/blocks\[3\]\.lineStyle/),
      ]),
    );
  });

  it('validates items table columns', () => {
    const tpl = emptyTemplate();
    const row = createRow([12]);
    const b = createBlock('itemsTable');
    row.columns[0].blocks = [{ ...b, columns: [...b.columns, { key: 'cost' as never, label: 'Cost', visible: true }] }];
    tpl.body = [row];
    expect(errorsOf(tpl)).toEqual([expect.stringMatching(/blocks\[0\]\.columns\[7\]\.key/)]);
  });

  it('validates table dimensions', () => {
    const tpl = emptyTemplate();
    const row = createRow([12]);
    const cell = { type: 'doc', content: [] };
    row.columns[0].blocks = [
      { ...createBlock('table'), rows: Array.from({ length: LIMITS.maxTableRows + 1 }, () => [cell]) },
      { ...createBlock('table'), rows: [Array.from({ length: LIMITS.maxTableColumns + 1 }, () => cell)] },
    ];
    tpl.body = [row];
    const errs = errorsOf(tpl);
    expect(errs.some((e) => e.startsWith('body[0].columns[0].blocks[0].rows'))).toBe(true);
    expect(errs.some((e) => e.startsWith('body[0].columns[0].blocks[1].rows[0]'))).toBe(true);
  });

  it('validates visibility value types', () => {
    const tpl = emptyTemplate() as unknown as { visibility: Record<string, unknown> };
    tpl.visibility.tax = 'no';
    expect(errorsOf(tpl)).toEqual([expect.stringMatching(/^visibility\.tax/)]);
  });
});
