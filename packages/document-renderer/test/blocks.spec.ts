import type { DocumentRenderContext, ItemsTableBlock, TotalsBlock } from '@bitcrm/types';
import { DOCUMENT_BLOCK_TYPES } from '@bitcrm/types';
import { createBlock, createRow, newId, renderBlockHtml, sampleRenderContext } from '../src';
import { doc, p, t, tag, templateWith } from './helpers';

const ctx = sampleRenderContext('invoice');
const tpl = templateWith();

/** Visible text content (tags stripped, entities kept). */
function text(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('newId / createBlock / createRow', () => {
  it('newId returns unique non-empty ids', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]{8,}$/);
  });

  it.each(DOCUMENT_BLOCK_TYPES)('createBlock(%s) builds a block with id and type', (type) => {
    const b = createBlock(type);
    expect(b.type).toBe(type);
    expect(b.id).toBeTruthy();
  });

  it('createRow builds columns with the given spans', () => {
    const row = createRow([4, 8]);
    expect(row.id).toBeTruthy();
    expect(row.columns.map((c) => c.span)).toEqual([4, 8]);
    expect(row.columns.every((c) => c.blocks.length === 0 && !!c.id)).toBe(true);
  });

  it('createRow rejects invalid spans', () => {
    expect(() => createRow([6, 5])).toThrow();
    expect(() => createRow([3, 3, 3, 1, 1, 1])).toThrow();
    expect(() => createRow([])).toThrow();
  });
});

describe('renderBlockHtml', () => {
  it('text: paragraphs, headings, marks, lists, breaks, merge tags', () => {
    const block = {
      ...createBlock('text'),
      content: doc(
        { type: 'heading', attrs: { level: 2 }, content: [t('Title')] },
        p(
          t('B', [{ type: 'bold' }]),
          t('I', [{ type: 'italic' }]),
          t('U', [{ type: 'underline' }]),
          t('C', [{ type: 'textStyle', attrs: { color: '#ff0000' } }]),
          { type: 'hardBreak' },
          t('L', [{ type: 'link', attrs: { href: 'https://example.com' } }]),
        ),
        { type: 'bulletList', content: [{ type: 'listItem', content: [p(t('one'))] }] },
        { type: 'orderedList', content: [{ type: 'listItem', content: [p(tag('client.fullName'))] }] },
        p(),
      ),
    };
    const html = renderBlockHtml(block, ctx, tpl);
    expect(html).toContain('<h2');
    expect(html).toContain('<strong>B</strong>');
    expect(html).toContain('<em>I</em>');
    expect(html).toContain('<u>U</u>');
    expect(html).toContain('<span style="color:#ff0000">C</span>');
    expect(html).toContain('<br>');
    expect(html).toContain('<a href="https://example.com"');
    expect(html).toContain('<ul><li><p>one</p></li></ul>');
    expect(html).toContain(`<ol><li><p>${ctx.client.fullName}</p></li></ol>`);
    expect(html).toContain('<p><br></p>');
  });

  it('text: interpolates {{tags}} inside plain text', () => {
    const block = { ...createBlock('text'), content: doc(p(t('No. {{document.number}}'))) };
    expect(renderBlockHtml(block, ctx, tpl)).toContain(`No. ${ctx.document.number}`);
  });

  it('text: drops paragraphs/headings whose merge tags all resolve empty', () => {
    const c = { ...ctx, client: { ...ctx.client, companyName: undefined, email: '' } };
    const block = {
      ...createBlock('text'),
      content: doc(
        p(tag('client.fullName')),
        p(tag('client.companyName')),
        p(t('Email: {{client.email}}')),
        p(t('Company: '), tag('client.companyName'), t(' / '), tag('client.firstName')),
        { type: 'heading', attrs: { level: 3 }, content: [tag('client.companyName')] },
        p(t('static')),
        p(),
      ),
    };
    const html = renderBlockHtml(block, c, tpl);
    expect(html).toBe(
      `<div class="blk blk-text"><div class="rt"><p>${ctx.client.fullName}</p><p>Company:  / ${ctx.client.firstName}</p><p>static</p><p><br></p></div></div>`,
    );
  });

  it('applies block style inline and a type class', () => {
    const block = {
      ...createBlock('spacer'),
      style: { align: 'right' as const, color: '#123456', background: 'white', fontSize: 14, fontWeight: 'bold' as const, paddingLeft: 4, borderColor: '#000', borderWidth: 1, borderRadius: 4 },
    };
    const html = renderBlockHtml(block, ctx, tpl);
    expect(html).toContain('class="blk blk-spacer"');
    expect(html).toContain('text-align:right');
    expect(html).toContain('color:#123456');
    expect(html).toContain('background:white');
    expect(html).toContain('font-size:14px');
    expect(html).toContain('font-weight:700');
    expect(html).toContain('padding-left:4px');
    expect(html).toContain('border:1px solid #000');
    expect(html).toContain('border-radius:4px');
  });

  it('adds data-block-id only when showBlockIds', () => {
    const b = createBlock('divider');
    expect(renderBlockHtml(b, ctx, tpl)).not.toContain('data-block-id');
    expect(renderBlockHtml(b, ctx, tpl, { showBlockIds: true })).toContain(`data-block-id="${b.id}"`);
  });

  it('image: renders asset with width and alignment', () => {
    const b = { ...createBlock('image'), assetId: 'a1', widthPercent: 50, alt: 'Van', style: { align: 'center' as const } };
    const html = renderBlockHtml(b, { ...ctx, assets: { a1: 'https://cdn.example.com/van.png' } }, tpl);
    expect(html).toContain('<img src="https://cdn.example.com/van.png"');
    expect(html).toContain('alt="Van"');
    expect(html).toContain('width:50%');
    expect(html).toContain('text-align:center');
  });

  it('image: placeholder in screen mode, nothing in pdf mode when missing', () => {
    const b = { ...createBlock('image'), assetId: 'missing' };
    expect(renderBlockHtml(b, ctx, tpl, { mode: 'screen' })).toContain('placeholder');
    expect(renderBlockHtml(b, ctx, tpl, { mode: 'pdf' })).toBe('');
  });

  it('image: clamps width', () => {
    const b = { ...createBlock('image'), assetId: 'a1', widthPercent: 500 };
    expect(renderBlockHtml(b, { ...ctx, assets: { a1: 'https://x.io/a.png' } }, tpl)).toContain('width:100%');
  });

  it('logo: uses business logo with max height', () => {
    const b = { ...createBlock('logo'), maxHeight: 60 };
    const html = renderBlockHtml(b, { ...ctx, business: { ...ctx.business, logoUrl: 'data:image/png;base64,AAA' } }, tpl);
    expect(html).toContain('<img src="data:image/png;base64,AAA"');
    expect(html).toContain('max-height:60px');
  });

  it('logo: placeholder in screen, nothing in pdf when missing', () => {
    const c = { ...ctx, business: { ...ctx.business, logoUrl: undefined } };
    expect(renderBlockHtml(createBlock('logo'), c, tpl, { mode: 'screen' })).toContain('placeholder');
    expect(renderBlockHtml(createBlock('logo'), c, tpl, { mode: 'pdf' })).toBe('');
  });

  it('divider: thickness and style', () => {
    const b = { ...createBlock('divider'), thickness: 3, lineStyle: 'dashed' as const };
    expect(renderBlockHtml(b, ctx, tpl)).toContain('border-top:3px dashed');
  });

  it('spacer: height', () => {
    expect(renderBlockHtml({ ...createBlock('spacer'), height: 40 }, ctx, tpl)).toContain('height:40px');
  });

  it('table: header row, borders, widths, rich cells', () => {
    const b = {
      ...createBlock('table'),
      rows: [
        [doc(p(t('H1'))), doc(p(t('H2')))],
        [doc(p(tag('document.number'))), doc(p(t('v', [{ type: 'bold' }])))],
      ],
      headerRow: true,
      bordered: true,
      columnWidths: [30, 70],
    };
    const html = renderBlockHtml(b, ctx, tpl);
    expect(html).toContain('<thead>');
    expect(html).toContain('<th');
    expect(html).toContain('bordered');
    expect(html).toContain('<col style="width:30%">');
    expect(html).toContain(ctx.document.number);
    expect(html).toContain('<strong>v</strong>');
  });

  it('table: no header row renders only td', () => {
    const b = { ...createBlock('table'), headerRow: false, bordered: false, rows: [[doc(p(t('a')))]] };
    const html = renderBlockHtml(b, ctx, tpl);
    expect(html).not.toContain('<th');
    expect(html).not.toContain('bordered');
  });

  it('field: label + resolved value', () => {
    const b = { ...createBlock('field'), path: 'document.dueDate', label: 'Due date' };
    const html = renderBlockHtml(b, ctx, tpl);
    expect(text(html)).toContain(`Due date ${ctx.document.dueDate}`);
  });

  it('field: hideIfEmpty hides the block', () => {
    const b = { ...createBlock('field'), path: 'job.poNumber', label: 'PO', hideIfEmpty: true };
    const c = { ...ctx, job: { ...ctx.job!, poNumber: undefined } };
    expect(renderBlockHtml(b, c, tpl)).toBe('');
    expect(renderBlockHtml({ ...b, hideIfEmpty: false }, c, tpl)).toContain('PO');
  });

  describe('itemsTable', () => {
    const items: DocumentRenderContext['items'] = [
      { name: 'Rekey', description: 'Rekey 2 cylinders', sku: 'RK-1', quantity: 2, unitPrice: 45, amount: 90, taxable: true },
      { name: 'Service call', quantity: 1, unitPrice: 79, amount: 79, taxable: false },
    ];
    const c = { ...ctx, items };
    const block = (): ItemsTableBlock => createBlock('itemsTable');

    it('renders items with money formatting and description under the name', () => {
      const html = renderBlockHtml(block(), c, templateWith());
      expect(html).toContain('Rekey');
      expect(html).toContain('<div class="item-desc">Rekey 2 cylinders</div>');
      expect(html).toContain('$45.00');
      expect(html).toContain('$90.00');
      expect(html).toContain('>2<');
    });

    it('header defaults to accent color and honors overrides', () => {
      const t1 = templateWith();
      t1.page.accentColor = '#abcdef';
      expect(renderBlockHtml(block(), c, t1)).toContain('background:#abcdef');
      const html = renderBlockHtml({ ...block(), headerBackground: '#000000', headerColor: '#eeeeee' }, c, t1);
      expect(html).toContain('background:#000000');
      expect(html).toContain('color:#eeeeee');
    });

    it('striped flag adds a class', () => {
      expect(renderBlockHtml({ ...block(), striped: true }, c, tpl)).toContain('striped');
      expect(renderBlockHtml({ ...block(), striped: false }, c, tpl)).not.toContain('striped');
    });

    it('uses configured labels and hides invisible columns', () => {
      const b = block();
      b.columns = b.columns.map((col) =>
        col.key === 'quantity' ? { ...col, label: 'Units' } : col.key === 'unitPrice' ? { ...col, visible: false } : col,
      );
      const html = renderBlockHtml(b, c, tpl);
      expect(html).toContain('>Units<');
      expect(html).not.toContain('$45.00');
    });

    it.each([
      ['quantity', 'Qty', '>2<'],
      ['unitPrice', 'Price', '$45.00'],
      ['lineAmount', 'Amount', '$90.00'],
      ['description', 'Description', 'Rekey 2 cylinders'],
    ] as const)('template visibility.%s=false hides that column', (key, label, needle) => {
      const t1 = templateWith();
      const shown = renderBlockHtml(block(), c, t1);
      expect(shown).toContain(needle);
      t1.visibility = { ...t1.visibility, [key]: false };
      const html = renderBlockHtml(block(), c, t1);
      expect(html).not.toContain(needle);
      expect(html).not.toContain(`>${label}<`);
    });

    it('sku and taxable mark are shown only when visibility enables them', () => {
      const t1 = templateWith();
      expect(renderBlockHtml(block(), c, t1)).not.toContain('RK-1');
      t1.visibility = { ...t1.visibility, sku: true, taxableMark: true };
      const html = renderBlockHtml(block(), c, t1);
      expect(html).toContain('RK-1');
      expect(html).toContain('class="tax-mark"');
      expect(html.match(/class="tax-mark"/g)).toHaveLength(1);
    });

    it('shows an empty-state row in screen mode', () => {
      expect(renderBlockHtml(block(), { ...ctx, items: [] }, tpl, { mode: 'screen' })).toContain('No items');
      expect(renderBlockHtml(block(), { ...ctx, items: [] }, tpl, { mode: 'pdf' })).not.toContain('No items');
    });
  });

  describe('totals', () => {
    const c: DocumentRenderContext = {
      ...ctx,
      kind: 'invoice',
      totals: { subtotal: 200, discount: 20, taxRateName: 'CT Sales', taxRatePercent: 6.35, tax: 11.43, total: 191.43, amountPaid: 50, balanceDue: 141.43 },
    };
    const block = (over: Partial<TotalsBlock> = {}): TotalsBlock => ({ ...createBlock('totals'), ...over });

    it('renders all rows', () => {
      const s = text(renderBlockHtml(block(), c, templateWith()));
      expect(s).toContain('Subtotal $200.00');
      expect(s).toContain('Discount -$20.00');
      expect(s).toContain('Tax (CT Sales 6.35%) $11.43');
      expect(s).toContain('Total $191.43');
      expect(s).toContain('Paid -$50.00');
      expect(s).toContain('Balance due $141.43');
    });

    it('uses a custom total label', () => {
      expect(text(renderBlockHtml(block({ totalLabel: 'Grand total' }), c, tpl))).toContain('Grand total $191.43');
    });

    it('tax label without a name', () => {
      const c2 = { ...c, totals: { ...c.totals, taxRateName: undefined } };
      expect(text(renderBlockHtml(block(), c2, tpl))).toContain('Tax (6.35%) $11.43');
    });

    it('hides discount and tax rows when zero', () => {
      const c2 = { ...c, totals: { ...c.totals, discount: 0, tax: 0, amountPaid: 0 } };
      const s = text(renderBlockHtml(block(), c2, tpl));
      expect(s).not.toContain('Discount');
      expect(s).not.toContain('Tax');
      expect(s).not.toContain('Paid');
    });

    it('hides rows by block flags', () => {
      const s = text(renderBlockHtml(block({ showSubtotal: false, showDiscount: false, showTax: false, showPaid: false, showBalance: false }), c, tpl));
      expect(s).toBe('Total $191.43');
    });

    it('hides rows by template visibility', () => {
      const t1 = templateWith();
      t1.visibility = { ...t1.visibility, discount: false, tax: false, payments: false, balance: false };
      const s = text(renderBlockHtml(block(), c, t1));
      expect(s).toBe('Subtotal $200.00 Total $191.43');
    });

    it('never shows paid/balance for estimates', () => {
      const s = text(renderBlockHtml(block(), { ...c, kind: 'estimate' }, tpl));
      expect(s).not.toContain('Paid');
      expect(s).not.toContain('Balance');
    });
  });

  describe('signature', () => {
    it('renders the signature image when present', () => {
      const c = { ...ctx, signature: { imageUrl: 'data:image/png;base64,SIG', signedBy: 'Jane Doe', signedAt: 'Sep 1, 2026' } };
      const html = renderBlockHtml({ ...createBlock('signature'), label: 'Client signature', showDate: true }, c, tpl);
      expect(html).toContain('<img src="data:image/png;base64,SIG"');
      expect(text(html)).toContain('Jane Doe');
      expect(text(html)).toContain('Sep 1, 2026');
    });

    it('renders a signature line with label and optional date otherwise', () => {
      const c = { ...ctx, signature: undefined };
      const html = renderBlockHtml({ ...createBlock('signature'), label: 'Approved by', showDate: true }, c, tpl);
      expect(html).toContain('sig-line');
      expect(text(html)).toContain('Approved by');
      expect(text(html)).toContain('Date');
      const noDate = renderBlockHtml({ ...createBlock('signature'), label: 'Approved by', showDate: false }, c, tpl);
      expect(text(noDate)).not.toContain('Date');
    });
  });

  describe('notes', () => {
    it('renders title and multi-line notes', () => {
      const c = { ...ctx, document: { ...ctx.document, notes: 'Line 1\nLine 2' } };
      const html = renderBlockHtml({ ...createBlock('notes'), title: 'Notes' }, c, tpl);
      expect(html).toContain('Notes');
      expect(html).toContain('Line 1<br>Line 2');
    });

    it('is hidden in pdf mode when empty, placeholder in screen mode', () => {
      const c = { ...ctx, document: { ...ctx.document, notes: '  ' } };
      expect(renderBlockHtml(createBlock('notes'), c, tpl, { mode: 'pdf' })).toBe('');
      expect(renderBlockHtml(createBlock('notes'), c, tpl, { mode: 'screen' })).toContain('placeholder');
    });
  });

  it('pageBreak renders a page-break element', () => {
    expect(renderBlockHtml(createBlock('pageBreak'), ctx, tpl, { mode: 'pdf' })).toContain('page-break');
    expect(renderBlockHtml(createBlock('pageBreak'), ctx, tpl, { mode: 'screen' })).toContain('page-break');
  });

  it('unknown block types render nothing', () => {
    expect(renderBlockHtml({ id: 'x', type: 'video' } as never, ctx, tpl)).toBe('');
  });
});
