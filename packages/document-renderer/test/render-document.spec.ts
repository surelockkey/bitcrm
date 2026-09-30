import { createBlock, createRow, renderDocumentHtml, sampleRenderContext } from '../src';
import { doc, emptyTemplate, p, t } from './helpers';

const ctx = sampleRenderContext('invoice');

function tplWithSections() {
  const tpl = emptyTemplate();
  const header = createRow([12]);
  header.columns[0].blocks = [{ ...createBlock('text'), content: doc(p(t('HEADER-MARK'))) }];
  const body = createRow([6, 6]);
  body.columns[0].blocks = [{ ...createBlock('text'), content: doc(p(t('BODY-LEFT'))) }];
  body.columns[1].blocks = [{ ...createBlock('text'), content: doc(p(t('BODY-RIGHT'))) }];
  body.gap = 24;
  const footer = createRow([12]);
  footer.columns[0].blocks = [{ ...createBlock('text'), content: doc(p(t('FOOTER-MARK'))) }];
  tpl.header = [header];
  tpl.body = [body];
  tpl.footer = [footer];
  return { tpl, header, body, footer };
}

describe('renderDocumentHtml', () => {
  it('produces a self-contained html document', () => {
    const { tpl } = tplWithSections();
    const html = renderDocumentHtml(tpl, ctx);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain('<style>');
    expect(html).toContain('</html>');
    expect(html).not.toMatch(/<script/i);
    expect(html.indexOf('HEADER-MARK')).toBeLessThan(html.indexOf('BODY-LEFT'));
    expect(html.indexOf('BODY-RIGHT')).toBeLessThan(html.indexOf('FOOTER-MARK'));
  });

  it('uses a 12-column grid with spans and gap', () => {
    const { tpl } = tplWithSections();
    const html = renderDocumentHtml(tpl, ctx);
    expect(html).toContain('grid-template-columns:repeat(12, minmax(0, 1fr))');
    expect(html).toContain('grid-column:span 6');
    expect(html).toContain('column-gap:24px');
  });

  it('applies column vertical alignment and row style', () => {
    const { tpl, body } = tplWithSections();
    body.columns[1].verticalAlign = 'bottom';
    body.style = { background: '#eeeeee', paddingTop: 8 };
    const html = renderDocumentHtml(tpl, ctx);
    expect(html).toContain('align-self:end');
    expect(html).toContain('background:#eeeeee');
    expect(html).toContain('padding-top:8px');
  });

  it('screen mode: paper on neutral background with page width and margins', () => {
    const { tpl } = tplWithSections();
    tpl.page.size = 'letter';
    tpl.page.marginTop = 20;
    const html = renderDocumentHtml(tpl, ctx, { mode: 'screen' });
    expect(html).toContain('class="paper"');
    expect(html).toContain('width:8.5in');
    expect(html).toContain('box-shadow');
    expect(html).toContain('padding:20mm 15mm 15mm 15mm');
    expect(html).not.toContain('@page');
    expect(html).not.toContain('<thead');
  });

  it('screen mode: a4 width', () => {
    const { tpl } = tplWithSections();
    tpl.page.size = 'a4';
    expect(renderDocumentHtml(tpl, ctx)).toContain('width:210mm');
  });

  it('screen mode may load web fonts; pdf mode never hits the network', () => {
    const { tpl } = tplWithSections();
    tpl.page.fontFamily = 'Inter';
    expect(renderDocumentHtml(tpl, ctx, { mode: 'screen' })).toContain('fonts.googleapis.com');
    const pdf = renderDocumentHtml(tpl, ctx, { mode: 'pdf' });
    expect(pdf).not.toContain('fonts.googleapis.com');
    expect(pdf).not.toMatch(/<link/i);
    expect(pdf).toContain('font-family:"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif');
  });

  it.each([
    ['Georgia', 'Georgia, "Times New Roman", Times, serif'],
    ['Courier New', '"Courier New", Courier, monospace'],
    ['Helvetica', '"Helvetica Neue", Helvetica, Arial, sans-serif'],
  ] as const)('font %s has a safe fallback stack', (font, stack) => {
    const { tpl } = tplWithSections();
    tpl.page.fontFamily = font;
    const html = renderDocumentHtml(tpl, ctx);
    expect(html).toContain(`font-family:${stack}`);
    expect(html).not.toContain('fonts.googleapis.com');
  });

  it('falls back to a safe font for unknown font values', () => {
    const { tpl } = tplWithSections();
    (tpl.page as { fontFamily: string }).fontFamily = 'Comic"; } body { x';
    const html = renderDocumentHtml(tpl, ctx);
    expect(html).not.toContain('Comic');
  });

  it('pdf mode: @page size/margins and repeating header/footer via thead/tfoot', () => {
    const { tpl } = tplWithSections();
    tpl.page.size = 'a4';
    tpl.page.marginTop = 12;
    tpl.page.marginRight = 10;
    tpl.page.marginBottom = 14;
    tpl.page.marginLeft = 11;
    const html = renderDocumentHtml(tpl, ctx, { mode: 'pdf' });
    expect(html).toContain('@page { size: A4; margin: 12mm 10mm 14mm 11mm; }');
    expect(html).toMatch(/<table class="doc-layout">\s*<thead><tr><td>[\s\S]*HEADER-MARK[\s\S]*<\/td><\/tr><\/thead>/);
    expect(html).toMatch(/<tfoot><tr><td>[\s\S]*FOOTER-MARK[\s\S]*<\/td><\/tr><\/tfoot>/);
    expect(html).toMatch(/<tbody><tr><td>[\s\S]*BODY-LEFT[\s\S]*<\/td><\/tr><\/tbody>/);
    expect(html).toContain('display: table-header-group');
    expect(html).toContain('display: table-footer-group');
    expect(html).toContain('-webkit-print-color-adjust: exact');
    expect(html).not.toContain('class="paper"');
  });

  it('pdf mode: letter page size and page-break css', () => {
    const { tpl } = tplWithSections();
    const html = renderDocumentHtml(tpl, ctx, { mode: 'pdf' });
    expect(html).toContain('size: letter;');
    expect(html).toContain('.page-break');
    expect(html).toContain('break-after: page');
  });

  it('pdf mode: omits thead/tfoot when header/footer are empty', () => {
    const { tpl } = tplWithSections();
    tpl.header = [];
    tpl.footer = [];
    const html = renderDocumentHtml(tpl, ctx, { mode: 'pdf' });
    expect(html).not.toContain('<thead>');
    expect(html).not.toContain('<tfoot>');
    expect(html).toContain('BODY-LEFT');
  });

  it('showBlockIds adds data-row-id and data-block-id', () => {
    const { tpl, body } = tplWithSections();
    const plain = renderDocumentHtml(tpl, ctx);
    expect(plain).not.toContain('data-row-id');
    expect(plain).not.toContain('data-block-id');
    const html = renderDocumentHtml(tpl, ctx, { showBlockIds: true });
    expect(html).toContain(`data-row-id="${body.id}"`);
    expect(html).toContain(`data-block-id="${body.columns[0].blocks[0].id}"`);
    expect(html).toContain(`data-column-id="${body.columns[0].id}"`);
    expect(html).toContain('data-section="body"');
  });

  it('applies page text/accent/background colors and base font size', () => {
    const { tpl } = tplWithSections();
    tpl.page.textColor = '#222222';
    tpl.page.accentColor = '#ff6600';
    tpl.page.background = '#fffaf0';
    tpl.page.baseFontSize = 12;
    const html = renderDocumentHtml(tpl, ctx);
    expect(html).toContain('--accent:#ff6600');
    expect(html).toContain('color:#222222');
    expect(html).toContain('background:#fffaf0');
    expect(html).toContain('font-size:12px');
  });

  it('falls back to default colors when page colors are invalid', () => {
    const { tpl } = tplWithSections();
    tpl.page.accentColor = 'nope';
    expect(renderDocumentHtml(tpl, ctx)).toMatch(/--accent:#[0-9a-f]{6}/);
  });

  it('tolerates missing sections and visibility (defensive)', () => {
    const broken = { page: emptyTemplate().page } as never;
    expect(() => renderDocumentHtml(broken, ctx)).not.toThrow();
  });
});
