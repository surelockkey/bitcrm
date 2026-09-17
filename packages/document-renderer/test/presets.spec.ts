import type { DocumentBlock, DocumentTemplateContent } from '@bitcrm/types';
import { DOCUMENT_TEMPLATE_KINDS } from '@bitcrm/types';
import { DOCUMENT_PRESETS, createTemplateContent, renderDocumentHtml, sampleRenderContext } from '../src';

function allBlocks(c: DocumentTemplateContent): DocumentBlock[] {
  return [...c.header, ...c.body, ...c.footer].flatMap((r) => r.columns.flatMap((col) => col.blocks));
}

function allIds(c: DocumentTemplateContent): string[] {
  return [...c.header, ...c.body, ...c.footer].flatMap((r) => [
    r.id,
    ...r.columns.flatMap((col) => [col.id, ...col.blocks.map((b) => b.id)]),
  ]);
}

describe('DOCUMENT_PRESETS', () => {
  it('lists classic, modern, minimal with names and descriptions', () => {
    expect(DOCUMENT_PRESETS.map((p) => p.id)).toEqual(['classic', 'modern', 'minimal']);
    for (const p of DOCUMENT_PRESETS) {
      expect(p.name).toBeTruthy();
      expect(p.description).toBeTruthy();
    }
  });
});

describe('createTemplateContent', () => {
  it.each(['classic', 'modern', 'minimal'])('invoice/%s has header, body, footer with items and totals', (preset) => {
    const c = createTemplateContent('invoice', preset);
    expect(c.header.length + c.body.length).toBeGreaterThan(0);
    expect(c.footer.length).toBeGreaterThan(0);
    const types = allBlocks(c).map((b) => b.type);
    expect(types).toContain('itemsTable');
    expect(types).toContain('totals');
    expect(types).toContain('logo');
    expect(types).toContain('notes');
    expect(types).toContain('signature');
  });

  it('classic invoice has title, due date field, bill-to and terms', () => {
    const c = createTemplateContent('invoice', 'classic');
    const json = JSON.stringify(c);
    expect(json).toContain('INVOICE');
    expect(json).toContain('document.dueDate');
    expect(json).toContain('BILL TO');
    expect(json).toContain('SERVICE ADDRESS');
    expect(json).toContain('Thank you');
  });

  it('estimate presets say ESTIMATE and do not reference invoice-only tags', () => {
    for (const preset of ['classic', 'modern', 'minimal']) {
      const json = JSON.stringify(createTemplateContent('estimate', preset));
      expect(json.toUpperCase()).toContain('ESTIMATE');
      expect(json).not.toContain('INVOICE');
      expect(json).not.toContain('document.dueDate');
      expect(json).not.toContain('totals.balanceDue');
    }
  });

  it('custom kind is a letter-like layout without items/totals', () => {
    const c = createTemplateContent('custom');
    const types = allBlocks(c).map((b) => b.type);
    expect(types).toContain('logo');
    expect(types).toContain('text');
    expect(types).toContain('signature');
    expect(types).not.toContain('itemsTable');
    expect(types).not.toContain('totals');
  });

  it('defaults to classic for unknown/missing preset', () => {
    const a = createTemplateContent('invoice', 'nope');
    const b = createTemplateContent('invoice');
    const c = createTemplateContent('invoice', 'classic');
    expect(a.page).toEqual(c.page);
    expect(b.page).toEqual(c.page);
  });

  it('presets differ in page style', () => {
    const pages = ['classic', 'modern', 'minimal'].map((p) => JSON.stringify(createTemplateContent('invoice', p).page));
    expect(new Set(pages).size).toBe(3);
  });

  it('generates unique ids and fresh ids on every call', () => {
    const a = createTemplateContent('invoice', 'modern');
    const ids = allIds(a);
    expect(new Set(ids).size).toBe(ids.length);
    const b = createTemplateContent('invoice', 'modern');
    expect(allIds(b).some((id) => ids.includes(id))).toBe(false);
  });

  it('rows always sum to 12', () => {
    for (const kind of DOCUMENT_TEMPLATE_KINDS) {
      for (const preset of ['classic', 'modern', 'minimal']) {
        const c = createTemplateContent(kind, preset);
        for (const r of [...c.header, ...c.body, ...c.footer]) {
          expect(r.columns.reduce((s, col) => s + col.span, 0)).toBe(12);
        }
      }
    }
  });
});

describe('sampleRenderContext', () => {
  it.each(DOCUMENT_TEMPLATE_KINDS)('%s: realistic, consistent sample data', (kind) => {
    const ctx = sampleRenderContext(kind);
    expect(ctx.kind).toBe(kind);
    expect(ctx.items.length).toBeGreaterThanOrEqual(3);
    expect(ctx.items.length).toBeLessThanOrEqual(4);
    expect(ctx.items.some((i) => !i.taxable)).toBe(true);
    expect(ctx.totals.taxRatePercent).toBe(6.35);
    expect(ctx.totals.discount).toBeGreaterThan(0);
    const subtotal = ctx.items.reduce((s, i) => s + i.amount, 0);
    expect(ctx.totals.subtotal).toBeCloseTo(subtotal, 2);
    for (const i of ctx.items) expect(i.amount).toBeCloseTo(i.quantity * i.unitPrice, 2);
    expect(ctx.totals.total).toBeCloseTo(ctx.totals.subtotal - ctx.totals.discount + ctx.totals.tax, 2);
    expect(ctx.totals.balanceDue).toBeCloseTo(ctx.totals.total - ctx.totals.amountPaid, 2);
    expect(ctx.currency).toBe('USD');
    expect(ctx.business.name).toBeTruthy();
    expect(ctx.job?.number).toBeTruthy();
  });

  it('returns fresh objects', () => {
    const a = sampleRenderContext('invoice');
    a.client.firstName = 'Changed';
    expect(sampleRenderContext('invoice').client.firstName).not.toBe('Changed');
  });

  it('invoice has a due date; estimate does not', () => {
    expect(sampleRenderContext('invoice').document.dueDate).toBeTruthy();
    expect(sampleRenderContext('estimate').document.dueDate).toBeUndefined();
  });
});

describe('preset snapshots', () => {
  it.each(['classic', 'modern', 'minimal'])('invoice/%s renders (screen)', (preset) => {
    const html = renderDocumentHtml(createTemplateContent('invoice', preset), sampleRenderContext('invoice'));
    expect(html).toMatchSnapshot();
  });

  it.each(['classic', 'modern', 'minimal'])('estimate/%s renders (pdf)', (preset) => {
    const html = renderDocumentHtml(createTemplateContent('estimate', preset), sampleRenderContext('estimate'), { mode: 'pdf' });
    expect(html).toMatchSnapshot();
  });

  it('custom renders (pdf)', () => {
    const html = renderDocumentHtml(createTemplateContent('custom'), sampleRenderContext('custom'), { mode: 'pdf' });
    expect(html).toMatchSnapshot();
  });

  it('rendered sample invoice contains resolved key values', () => {
    const ctx = sampleRenderContext('invoice');
    for (const preset of ['classic', 'modern', 'minimal']) {
      const html = renderDocumentHtml(createTemplateContent('invoice', preset), ctx, { mode: 'pdf' });
      expect(html).toContain(ctx.document.number);
      expect(html).toContain(ctx.client.fullName);
      expect(html).toContain(ctx.items[0].name);
      expect(html).toContain('Tax (');
      expect(html).not.toContain('{{');
    }
  });
});
