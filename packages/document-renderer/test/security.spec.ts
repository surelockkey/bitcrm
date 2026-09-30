import type { DocumentRenderContext, TextBlock } from '@bitcrm/types';
import { createBlock, escapeHtml, renderBlockHtml, renderDocumentHtml, safeColor, safeUrl, sampleRenderContext } from '../src';
import { doc, p, t, tag, templateWith } from './helpers';

const XSS = '<script>alert(1)</script>';

function textBlock(content: TextBlock['content']): TextBlock {
  return { ...createBlock('text'), content };
}

describe('escapeHtml', () => {
  it('escapes all significant characters', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
    );
  });
  it('handles non-strings', () => {
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(5)).toBe('5');
  });
});

describe('safeColor', () => {
  it.each(['#fff', '#FFFFFF', '#11223344', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'red', 'transparent', 'White'])(
    'accepts %s',
    (c) => expect(safeColor(c)).toBe(c.toLowerCase()),
  );
  it.each([
    'red; background:url(http://evil)',
    'expression(alert(1))',
    'url(javascript:alert(1))',
    '#ggg',
    'rgb(1,2,3);x:y',
    'var(--x)',
    '"><script>',
    'notacolor',
    '',
    42,
    null,
  ])('rejects %p', (c) => {
    expect(safeColor(c)).toBeUndefined();
  });
});

describe('safeUrl', () => {
  it('allows http(s) and mailto links', () => {
    expect(safeUrl('https://example.com/a?b=1', 'link')).toBe('https://example.com/a?b=1');
    expect(safeUrl('http://example.com', 'link')).toBe('http://example.com');
    expect(safeUrl('mailto:a@b.co', 'link')).toBe('mailto:a@b.co');
  });
  it.each(['javascript:alert(1)', ' JavaScript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<x>', 'vbscript:x', '//evil.com', 'ftp://x'])(
    'rejects link %p',
    (u) => expect(safeUrl(u, 'link')).toBeUndefined(),
  );
  it('allows raster data URIs and https for images, not svg', () => {
    expect(safeUrl('data:image/png;base64,AAAA', 'image')).toBe('data:image/png;base64,AAAA');
    expect(safeUrl('https://cdn.example.com/logo.png', 'image')).toBe('https://cdn.example.com/logo.png');
    expect(safeUrl('data:image/svg+xml;base64,AAAA', 'image')).toBeUndefined();
    expect(safeUrl('javascript:alert(1)', 'image')).toBeUndefined();
    expect(safeUrl('mailto:a@b.co', 'image')).toBeUndefined();
  });
});

describe('XSS protection in rendering', () => {
  const base = sampleRenderContext('invoice');
  const evil: DocumentRenderContext = {
    ...base,
    business: { ...base.business, name: XSS, logoUrl: 'javascript:alert(1)' },
    client: { ...base.client, fullName: `"><img src=x onerror=alert(1)>`, firstName: XSS },
    document: { ...base.document, notes: XSS },
    items: [{ name: XSS, description: '<iframe>', sku: '"x', quantity: 1, unitPrice: 1, amount: 1, taxable: true }],
    signature: { imageUrl: 'javascript:alert(1)', signedBy: XSS },
  };

  it('escapes interpolated text and merge-tag nodes', () => {
    const html = renderBlockHtml(
      textBlock(doc(p(t('Hello {{client.firstName}} '), tag('business.name'), t(XSS)))),
      evil,
      templateWith(),
    );
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;script&gt;');
  });

  it('never renders script tags anywhere in a full document', () => {
    const tpl = templateWith(
      createBlock('logo'),
      createBlock('itemsTable'),
      createBlock('notes'),
      createBlock('signature'),
      { ...createBlock('field'), path: 'client.fullName', label: XSS },
      textBlock(doc(p(tag('client.fullName')))),
    );
    for (const mode of ['screen', 'pdf'] as const) {
      const html = renderDocumentHtml(tpl, evil, { mode, showBlockIds: true });
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/<iframe/i);
      expect(html).not.toMatch(/<img src=x/i);
      expect(html).not.toMatch(/javascript:/i);
      expect(html).not.toMatch(/<[^>]*onerror=/i);
    }
  });

  it('drops javascript: links but keeps the text', () => {
    const html = renderBlockHtml(
      textBlock(doc(p(t('click', [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }])))),
      base,
      templateWith(),
    );
    expect(html).toContain('click');
    expect(html).not.toContain('<a');
    expect(html).not.toMatch(/javascript/i);
  });

  it('renders safe links with rel=noopener', () => {
    const html = renderBlockHtml(
      textBlock(doc(p(t('site', [{ type: 'link', attrs: { href: 'https://x.com/"onmouseover="a' } }])))),
      base,
      templateWith(),
    );
    expect(html).toContain('href="https://x.com/&quot;onmouseover=&quot;a"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('blocks style injection through color values', () => {
    const html = renderBlockHtml(
      {
        ...textBlock(doc(p(t('x', [{ type: 'textStyle', attrs: { color: 'red;background:url(//evil)' } }])))),
        style: { color: 'red;position:fixed', background: '#fff" onclick="x', borderColor: 'url(x)' },
      },
      base,
      templateWith(),
    );
    expect(html).not.toContain('evil');
    expect(html).not.toContain('position:fixed');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('url(');
  });

  it('blocks style injection through page colors', () => {
    const tpl = templateWith();
    tpl.page.accentColor = 'red;}</style><script>alert(1)</script>';
    tpl.page.textColor = '#000;background:url(x)';
    const html = renderDocumentHtml(tpl, base);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain('url(x)');
  });

  it('escapes attribute breakouts in block ids', () => {
    const block = { ...createBlock('spacer'), id: '"><script>alert(1)</script>' };
    const html = renderBlockHtml(block, base, templateWith(), { showBlockIds: true });
    expect(html).not.toContain('<script');
    expect(html).toContain('data-block-id="&quot;&gt;&lt;script&gt;');
  });

  it('ignores unknown rich-text nodes and marks', () => {
    const html = renderBlockHtml(
      textBlock(
        doc(
          { type: 'iframe', attrs: { src: 'https://evil' } },
          { type: 'rawHtml', text: XSS },
          p(t('ok', [{ type: 'onclick', attrs: { code: 'x' } }])),
        ),
      ),
      base,
      templateWith(),
    );
    expect(html).toContain('ok');
    expect(html).not.toContain('evil');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onclick');
  });

  it('clamps heading levels and numeric style values', () => {
    const html = renderBlockHtml(
      {
        ...textBlock(doc({ type: 'heading', attrs: { level: '1><script>' }, content: [t('H')] })),
        style: { fontSize: 100000, paddingTop: -50 },
      },
      base,
      templateWith(),
    );
    expect(html).toContain('<h1');
    expect(html).not.toContain('<script');
    expect(html).toContain('font-size:96px');
    expect(html).toContain('padding-top:0px');
  });

  it('does not render unsafe logo/signature/image urls', () => {
    const tpl = templateWith();
    const img = { ...createBlock('image'), assetId: 'a1' };
    const ctx = { ...evil, assets: { a1: 'javascript:alert(1)' } };
    expect(renderBlockHtml(img, ctx, tpl, { mode: 'pdf' })).not.toContain('<img');
    expect(renderBlockHtml(createBlock('logo'), ctx, tpl, { mode: 'pdf' })).not.toContain('<img');
    expect(renderBlockHtml(createBlock('signature'), ctx, tpl, { mode: 'pdf' })).not.toContain('<img');
  });
});
