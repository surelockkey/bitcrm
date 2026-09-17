import { createHash } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { DocumentTemplate } from '@bitcrm/types';
import { selectTemplate } from 'src/templates/template-selection';
import { generatePortalToken, hashPortalToken } from 'src/portal/portal-token';
import { pdfCacheHash } from 'src/documents/pdf-cache';
import { pdfS3Key } from 'src/common/constants/dynamo.constants';
import { EstimateItemDto } from 'src/estimates/dto/estimate-item.dto';
import { ProfileAddressDto } from 'src/business-profile/dto/update-business-profile.dto';

const tpl = (over: Partial<DocumentTemplate>): DocumentTemplate =>
  ({
    id: 'x',
    name: 'x',
    kind: 'invoice',
    isDefault: false,
    version: 1,
    createdBy: 'u',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as DocumentTemplate;

describe('selectTemplate', () => {
  const templates = [
    tpl({ id: 'default-inv', isDefault: true }),
    tpl({ id: 'rekey', autoApply: { jobTypeIds: ['jt-rekey'] } }),
    tpl({ id: 'nyc', autoApply: { serviceAreaIds: ['sa-nyc'] } }),
    tpl({ id: 'est-default', kind: 'estimate', isDefault: true }),
    tpl({ id: 'est-rekey', kind: 'estimate', autoApply: { jobTypeIds: ['jt-rekey'] } }),
  ];

  it('uses an explicit template of the right kind first', () => {
    expect(selectTemplate(templates, { kind: 'invoice', templateId: 'nyc', jobTypeId: 'jt-rekey' })?.id).toBe(
      'nyc',
    );
  });

  it('ignores an explicit id of another kind or that no longer exists', () => {
    expect(selectTemplate(templates, { kind: 'invoice', templateId: 'est-rekey' })?.id).toBe('default-inv');
    expect(selectTemplate(templates, { kind: 'invoice', templateId: 'gone' })?.id).toBe('default-inv');
  });

  it('then an auto-apply match by job type or service area', () => {
    expect(selectTemplate(templates, { kind: 'invoice', jobTypeId: 'jt-rekey' })?.id).toBe('rekey');
    expect(selectTemplate(templates, { kind: 'invoice', serviceAreaId: 'sa-nyc' })?.id).toBe('nyc');
    expect(selectTemplate(templates, { kind: 'estimate', jobTypeId: 'jt-rekey' })?.id).toBe('est-rekey');
  });

  it('matches on company too, and the most specific rule wins', () => {
    const all = [
      ...templates,
      tpl({ id: 'brand', autoApply: { businessProfileIds: ['bp-2'] }, createdAt: '2026-01-02T00:00:00.000Z' }),
      tpl({
        id: 'brand-rekey',
        autoApply: { businessProfileIds: ['bp-2'], jobTypeIds: ['jt-rekey'] },
        createdAt: '2026-01-03T00:00:00.000Z',
      }),
      tpl({
        id: 'brand-rekey-nyc',
        autoApply: { businessProfileIds: ['bp-2'], jobTypeIds: ['jt-rekey'], serviceAreaIds: ['sa-nyc'] },
        createdAt: '2026-01-04T00:00:00.000Z',
      }),
    ];
    expect(selectTemplate(all, { kind: 'invoice', businessProfileId: 'bp-2' })?.id).toBe('brand');
    expect(selectTemplate(all, { kind: 'invoice', businessProfileId: 'bp-2', jobTypeId: 'jt-rekey' })?.id).toBe('brand-rekey');
    expect(
      selectTemplate(all, { kind: 'invoice', businessProfileId: 'bp-2', jobTypeId: 'jt-rekey', serviceAreaId: 'sa-nyc' })?.id,
    ).toBe('brand-rekey-nyc');
    // Every dimension a rule names must match: another company never gets the brand templates.
    expect(selectTemplate(all, { kind: 'invoice', businessProfileId: 'bp-9', jobTypeId: 'jt-rekey' })?.id).toBe('rekey');
    // Equal specificity → the older template.
    expect(selectTemplate(all, { kind: 'invoice', jobTypeId: 'jt-rekey', serviceAreaId: 'sa-nyc' })?.id).toBe('rekey');
  });

  it('then the default for the kind', () => {
    expect(selectTemplate(templates, { kind: 'invoice', jobTypeId: 'other' })?.id).toBe('default-inv');
    expect(selectTemplate(templates, { kind: 'estimate' })?.id).toBe('est-default');
  });

  it('returns null when nothing of that kind exists (caller falls back to the seeded default)', () => {
    expect(selectTemplate([], { kind: 'invoice' })).toBeNull();
  });
});

describe('portal tokens', () => {
  it('are 32 random bytes as base64url, stored as their sha256', () => {
    const { token, hash } = generatePortalToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hashPortalToken(token)).toBe(hash);
    expect(generatePortalToken().token).not.toBe(token);
  });
});

describe('pdf cache key', () => {
  const t = { id: 'tpl-1', version: 3 };
  const ctx = { document: { number: '1' } } as never;

  it('is sha256 over template id + version + render context', () => {
    const expected = createHash('sha256')
      .update(`tpl-1:3:${JSON.stringify(ctx)}`)
      .digest('hex');
    expect(pdfCacheHash(t, ctx)).toBe(expected);
  });

  it('changes when the template version or the context changes', () => {
    const base = pdfCacheHash(t, ctx);
    expect(pdfCacheHash({ ...t, version: 4 }, ctx)).not.toBe(base);
    expect(pdfCacheHash(t, { document: { number: '2' } } as never)).not.toBe(base);
  });

  it('lives under billing/pdfs/<docId>/<hash>.pdf', () => {
    expect(pdfS3Key('d1', 'abc')).toBe('billing/pdfs/d1/abc.pdf');
  });
});

describe('ProfileAddressDto', () => {
  it('accepts optional lat/lng (the web address picker sends them)', () => {
    const base = { street: '1 Main', city: 'Hartford', state: 'CT', zip: '06103' };
    expect(validateSync(plainToInstance(ProfileAddressDto, { ...base, lat: 41.7, lng: -72.6 }))).toEqual([]);
    expect(validateSync(plainToInstance(ProfileAddressDto, base))).toEqual([]);
    expect(validateSync(plainToInstance(ProfileAddressDto, { ...base, lat: 91 })).map((e) => e.property)).toEqual(['lat']);
  });
});

describe('EstimateItemDto', () => {
  const errorsFor = (quantity: number) =>
    validateSync(
      plainToInstance(EstimateItemDto, {
        productId: 'p',
        name: 'Rekey',
        sku: 'RK',
        quantity,
        priceClient: 10,
        costCompany: 1,
        costForTech: 1,
      }),
    ).map((e) => e.property);

  it('requires at least 1 of a line, like a job line (sync-to-job would refuse less)', () => {
    expect(errorsFor(1)).toEqual([]);
    expect(errorsFor(2.5)).toEqual([]);
    expect(errorsFor(0.5)).toEqual(['quantity']);
  });
});
