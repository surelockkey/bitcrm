import { NotFoundException } from '@nestjs/common';
import { DealTaxResolver } from 'src/deals/billing/deal-tax.resolver';
import {
  createMockInternalHttpService,
  createMockTaxRate,
  createMockServiceArea,
} from '../../mocks';

describe('DealTaxResolver', () => {
  let http: ReturnType<typeof createMockInternalHttpService>;
  let serviceAreas: { findById: jest.Mock };
  let resolver: DealTaxResolver;

  const taxedArea = createMockServiceArea({
    id: 'area-1',
    name: 'Fulton',
    tax: { name: 'Fulton Tax', ratePercent: 8.9 },
  });

  beforeEach(() => {
    http = createMockInternalHttpService();
    serviceAreas = { findById: jest.fn().mockResolvedValue(taxedArea) };
    resolver = new DealTaxResolver(http as any, serviceAreas as any);
  });

  it('exempts a tax-exempt contact with no rate', async () => {
    http.getContact.mockResolvedValue({ id: 'c', taxExempt: true });

    expect(await resolver.resolve({ contactId: 'c', serviceAreaId: 'area-1' })).toEqual({
      taxSource: 'exempt', taxRateId: null, taxRateName: null, taxRatePercent: null,
    });
  });

  it('exempts when the deal company is tax-exempt', async () => {
    http.getContact.mockResolvedValue({ id: 'c' });
    http.getCompany.mockResolvedValue({ id: 'co', taxExempt: true });

    const tax = await resolver.resolve({ contactId: 'c', companyId: 'co', serviceAreaId: 'area-1' });
    expect(tax.taxSource).toBe('exempt');
    expect(http.getCompany).toHaveBeenCalledWith('co');
  });

  it("falls back to the contact's company when the deal has none", async () => {
    http.getContact.mockResolvedValue({ id: 'c', companyId: 'co-2' });
    http.getCompany.mockResolvedValue({ id: 'co-2', taxExempt: true });

    expect((await resolver.resolve({ contactId: 'c' })).taxSource).toBe('exempt');
    expect(http.getCompany).toHaveBeenCalledWith('co-2');
  });

  it("uses the service area's own tax (rate id = area id)", async () => {
    expect(await resolver.resolve({ contactId: 'c', serviceAreaId: 'area-1' })).toEqual({
      taxSource: 'service_area', taxRateId: 'area-1', taxRateName: 'Fulton Tax', taxRatePercent: 8.9,
    });
    expect(serviceAreas.findById).toHaveBeenCalledWith('area-1');
  });

  it("returns 'none' when the area has no tax, is missing, or there is no area (no account default)", async () => {
    serviceAreas.findById.mockResolvedValueOnce(createMockServiceArea({ id: 'area-2' }));
    expect((await resolver.resolve({ contactId: 'c', serviceAreaId: 'area-2' })).taxSource).toBe('none');

    serviceAreas.findById.mockRejectedValueOnce(new NotFoundException());
    expect((await resolver.resolve({ contactId: 'c', serviceAreaId: 'gone' })).taxSource).toBe('none');

    expect(await resolver.resolve({ contactId: 'c' })).toEqual({
      taxSource: 'none', taxRateId: null, taxRateName: null, taxRatePercent: null,
    });
  });

  it('does not fail when CRM is unreachable (treated as not exempt)', async () => {
    http.getContact.mockRejectedValue(new Error('down'));
    expect((await resolver.resolve({ contactId: 'c', serviceAreaId: 'area-1' })).taxSource).toBe('service_area');
  });

  it('snapshots a rate', () => {
    expect(resolver.snapshotOf(createMockTaxRate({ id: 'r', name: 'R', ratePercent: 5 }), 'manual')).toEqual({
      taxSource: 'manual', taxRateId: 'r', taxRateName: 'R', taxRatePercent: 5,
    });
  });

  it('compares and converts snapshots', () => {
    const snap = { taxSource: 'service_area' as const, taxRateId: 'x', taxRateName: 'X', taxRatePercent: 1 };
    expect(DealTaxResolver.sameTax({ ...snap }, snap)).toBe(true);
    expect(DealTaxResolver.sameTax({ ...snap, taxSource: 'manual' }, snap)).toBe(false);
    expect(DealTaxResolver.forCreate({ taxSource: 'none', taxRateId: null, taxRateName: null, taxRatePercent: null }))
      .toEqual({ taxSource: 'none' });
  });
});
