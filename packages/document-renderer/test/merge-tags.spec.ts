import type { DocumentRenderContext } from '@bitcrm/types';
import { DOCUMENT_TEMPLATE_KINDS } from '@bitcrm/types';
import { MERGE_TAGS, MERGE_TAG_GROUPS, formatMoney, interpolate, resolveMergeTag, sampleRenderContext } from '../src';

describe('formatMoney', () => {
  it('formats USD by default', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
  });
  it('formats other currencies', () => {
    expect(formatMoney(10, 'EUR')).toBe('€10.00');
  });
  it('treats non-finite values as 0', () => {
    expect(formatMoney(Number.NaN)).toBe('$0.00');
  });
  it('falls back gracefully on an invalid currency code', () => {
    expect(formatMoney(5, 'not-a-currency')).toBe('5.00');
  });
  it('formats negatives', () => {
    expect(formatMoney(-3)).toBe('-$3.00');
  });
});

describe('MERGE_TAGS', () => {
  const paths = MERGE_TAGS.map((t) => t.path);

  it('covers every documented render-context field', () => {
    const expected = [
      'business.name', 'business.legalName', 'business.phone', 'business.email', 'business.website',
      'business.licenseNumber', 'business.address',
      'client.firstName', 'client.lastName', 'client.fullName', 'client.companyName', 'client.email',
      'client.phone', 'client.address', 'client.billingAddress',
      'job.number', 'job.address', 'job.jobType', 'job.serviceArea', 'job.scheduledDate', 'job.technicians',
      'job.poNumber',
      'document.number', 'document.date', 'document.dueDate', 'document.paymentTerms', 'document.status',
      'document.name', 'document.notes',
      'totals.subtotal', 'totals.discount', 'totals.taxRateName', 'totals.taxRatePercent', 'totals.tax',
      'totals.total', 'totals.amountPaid', 'totals.balanceDue',
      'today',
    ];
    for (const p of expected) expect(paths).toContain(p);
  });

  it('has unique paths, a known group, kinds and a sample', () => {
    expect(new Set(paths).size).toBe(paths.length);
    const groups = MERGE_TAG_GROUPS.map((g) => g.id);
    for (const t of MERGE_TAGS) {
      expect(groups).toContain(t.group);
      expect(t.label.length).toBeGreaterThan(0);
      expect(t.sample.length).toBeGreaterThan(0);
      expect(t.kinds.length).toBeGreaterThan(0);
      for (const k of t.kinds) expect(DOCUMENT_TEMPLATE_KINDS).toContain(k);
    }
  });

  it('restricts invoice-only tags to invoices', () => {
    const due = MERGE_TAGS.find((t) => t.path === 'document.dueDate')!;
    expect(due.kinds).toEqual(['invoice']);
    const balance = MERGE_TAGS.find((t) => t.path === 'totals.balanceDue')!;
    expect(balance.kinds).toEqual(['invoice']);
  });
});

describe('resolveMergeTag', () => {
  const ctx = sampleRenderContext('invoice');

  it('resolves plain string fields', () => {
    expect(resolveMergeTag('client.fullName', ctx)).toBe(ctx.client.fullName);
    expect(resolveMergeTag('business.name', ctx)).toBe(ctx.business.name);
    expect(resolveMergeTag('job.number', ctx)).toBe(ctx.job!.number);
    expect(resolveMergeTag('today', ctx)).toBe(ctx.today);
  });

  it('formats money fields with the context currency', () => {
    const c: DocumentRenderContext = { ...ctx, currency: 'USD', totals: { ...ctx.totals, total: 1500 } };
    expect(resolveMergeTag('totals.total', c)).toBe('$1,500.00');
    expect(resolveMergeTag('totals.subtotal', { ...c, currency: 'EUR' })).toMatch(/^€/);
  });

  it('formats the tax percent', () => {
    const c = { ...ctx, totals: { ...ctx.totals, taxRatePercent: 6.35 } };
    expect(resolveMergeTag('totals.taxRatePercent', c)).toBe('6.35%');
  });

  it('resolves job custom fields dynamically', () => {
    const c = { ...ctx, job: { ...ctx.job!, customFields: { gateCode: '1234' } } };
    expect(resolveMergeTag('job.customFields.gateCode', c)).toBe('1234');
    expect(resolveMergeTag('job.customFields.missing', c)).toBe('');
  });

  it('accepts whitespace around the path', () => {
    expect(resolveMergeTag('  client.firstName ', ctx)).toBe(ctx.client.firstName);
  });

  it('returns empty string for missing values and unknown paths', () => {
    const c: DocumentRenderContext = { ...ctx, job: undefined, business: { name: 'X' } };
    expect(resolveMergeTag('job.number', c)).toBe('');
    expect(resolveMergeTag('business.phone', c)).toBe('');
    expect(resolveMergeTag('nope.nothing', c)).toBe('');
    expect(resolveMergeTag('', c)).toBe('');
  });

  it('does not expose non-whitelisted context data', () => {
    expect(resolveMergeTag('items', ctx)).toBe('');
    expect(resolveMergeTag('assets', ctx)).toBe('');
    expect(resolveMergeTag('business.logoUrl', ctx)).toBe('');
    expect(resolveMergeTag('constructor', ctx)).toBe('');
    expect(resolveMergeTag('__proto__.toString', ctx)).toBe('');
    expect(resolveMergeTag('job.customFields.__proto__', ctx)).toBe('');
  });

  it('supports invoice./estimate. aliases for document.*', () => {
    expect(resolveMergeTag('invoice.dueDate', ctx)).toBe(ctx.document.dueDate);
    expect(resolveMergeTag('estimate.number', ctx)).toBe(ctx.document.number);
  });
});

describe('interpolate', () => {
  const ctx = sampleRenderContext('invoice');

  it('replaces {{path}} occurrences', () => {
    expect(interpolate('Hi {{client.firstName}}, invoice #{{ document.number }}', ctx)).toBe(
      `Hi ${ctx.client.firstName}, invoice #${ctx.document.number}`,
    );
  });

  it('replaces missing values with empty string', () => {
    expect(interpolate('[{{unknown.tag}}]', ctx)).toBe('[]');
  });

  it('leaves text without tags untouched and does not re-interpolate values', () => {
    const c = { ...ctx, client: { ...ctx.client, firstName: '{{business.name}}' } };
    expect(interpolate('plain', c)).toBe('plain');
    expect(interpolate('{{client.firstName}}', c)).toBe('{{business.name}}');
  });

  it('does not escape (callers escape)', () => {
    const c = { ...ctx, client: { ...ctx.client, firstName: '<b>' } };
    expect(interpolate('{{client.firstName}}', c)).toBe('<b>');
  });
});
