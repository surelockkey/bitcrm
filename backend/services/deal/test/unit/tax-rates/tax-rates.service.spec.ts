import { NotFoundException } from '@nestjs/common';
import { TaxRatesService, taxRateFromArea } from 'src/tax-rates/tax-rates.service';
import { createMockServiceArea } from '../mocks';

/**
 * Tax rates are no longer a catalog: every service area that carries a `tax`
 * is exposed as one rate whose id is the area id.
 */
describe('TaxRatesService (derived from service areas)', () => {
  let areas: { list: jest.Mock; findById: jest.Mock };
  let service: TaxRatesService;

  const taxed = createMockServiceArea({
    id: 'a-ct',
    name: 'Connecticut',
    tax: { name: 'CT Sales Tax', ratePercent: 6.35 },
    updatedAt: '2026-09-01T00:00:00.000Z',
  });
  const archived = createMockServiceArea({
    id: 'a-old',
    name: 'Old market',
    active: false,
    tax: { name: 'Old Tax', ratePercent: 5 },
  });
  const untaxed = createMockServiceArea({ id: 'a-none', name: 'No tax here' });
  const other = createMockServiceArea({
    id: 'a-ny',
    name: 'New York',
    tax: { name: 'Albany Tax', ratePercent: 8 },
  });

  beforeEach(() => {
    areas = {
      list: jest.fn().mockResolvedValue([taxed, archived, untaxed, other]),
      findById: jest.fn(async (id: string) => {
        const hit = [taxed, archived, untaxed, other].find((a) => a.id === id);
        if (!hit) throw new NotFoundException();
        return hit;
      }),
    };
    service = new TaxRatesService(areas as any);
  });

  it('maps an area to a TaxRate (id = area id)', () => {
    expect(taxRateFromArea(taxed)).toEqual({
      id: 'a-ct',
      name: 'CT Sales Tax',
      ratePercent: 6.35,
      active: true,
      isDefault: false,
      isGroup: false,
      componentIds: [],
      serviceAreaId: 'a-ct',
      serviceAreaName: 'Connecticut',
      createdBy: taxed.createdBy,
      createdAt: taxed.createdAt,
      updatedAt: '2026-09-01T00:00:00.000Z',
    });
    expect(taxRateFromArea(untaxed)).toBeNull();
  });

  it('lists only areas with a tax, active only, sorted by name', async () => {
    const rates = await service.list();
    expect(rates.map((r) => r.id)).toEqual(['a-ny', 'a-ct']);
  });

  it('includes archived areas on request and in listAll', async () => {
    expect((await service.list({ includeInactive: true })).map((r) => r.id)).toEqual([
      'a-ny', 'a-ct', 'a-old',
    ]);
    expect((await service.listAll()).map((r) => r.id)).toContain('a-old');
  });

  it('finds a rate by area id', async () => {
    expect((await service.findById('a-ct')).ratePercent).toBe(6.35);
  });

  it('404s for an unknown area or an area without a tax', async () => {
    await expect(service.findById('missing')).rejects.toThrow(NotFoundException);
    await expect(service.findById('a-none')).rejects.toThrow(NotFoundException);
  });

  it('findOptional returns null instead of throwing', async () => {
    expect(await service.findOptional('a-none')).toBeNull();
    expect(await service.findOptional('missing')).toBeNull();
    expect((await service.findOptional('a-ny'))?.name).toBe('Albany Tax');
  });
});
