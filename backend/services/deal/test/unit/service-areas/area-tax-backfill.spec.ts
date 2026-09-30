import { planAreaTaxBackfill } from 'src/service-areas/area-tax-backfill';

const rate = (over: Record<string, unknown>) => ({
  PK: `TAX_RATE#${over.id}`,
  SK: 'METADATA',
  name: 'Rate',
  ratePercent: 5,
  isDefault: false,
  active: true,
  isGroup: false,
  componentIds: [],
  ...over,
});
const area = (over: Record<string, unknown>) => ({
  PK: `SERVICE_AREA#${over.id}`,
  SK: 'METADATA',
  name: `Area ${over.id}`,
  ...over,
});

describe('planAreaTaxBackfill', () => {
  it("copies the catalog rate's name/percent into area.tax and drops defaultTaxRateId", () => {
    const plan = planAreaTaxBackfill(
      [area({ id: 'a1', defaultTaxRateId: 'r1' })],
      [rate({ id: 'r1', name: 'CT Sales Tax', ratePercent: 6.35 })],
    );
    expect(plan.areaUpdates).toEqual([
      { areaId: 'a1', areaName: 'Area a1', tax: { name: 'CT Sales Tax', ratePercent: 6.35 } },
    ]);
    expect(plan.catalogKeys).toEqual([{ PK: 'TAX_RATE#r1', SK: 'METADATA' }]);
  });

  it('uses the effective percent of a group rate (active components)', () => {
    const plan = planAreaTaxBackfill(
      [area({ id: 'a1', defaultTaxRateId: 'g' })],
      [
        rate({ id: 'gst', name: 'GST', ratePercent: 5 }),
        rate({ id: 'pst', name: 'PST', ratePercent: 7 }),
        rate({ id: 'off', name: 'Off', ratePercent: 1, active: false }),
        rate({ id: 'g', name: 'GST+PST', ratePercent: 13, isGroup: true, componentIds: ['gst', 'pst', 'off'] }),
      ],
    );
    expect(plan.areaUpdates[0].tax).toEqual({ name: 'GST+PST', ratePercent: 12 });
  });

  it('keeps an existing area.tax (only removes the legacy pointer)', () => {
    const plan = planAreaTaxBackfill(
      [area({ id: 'a1', defaultTaxRateId: 'r1', tax: { name: 'Already', ratePercent: 1 } })],
      [rate({ id: 'r1' })],
    );
    expect(plan.areaUpdates).toEqual([{ areaId: 'a1', areaName: 'Area a1' }]);
  });

  it('removes a dangling pointer to a deleted rate, with a warning', () => {
    const plan = planAreaTaxBackfill([area({ id: 'a1', defaultTaxRateId: 'gone' })], []);
    expect(plan.areaUpdates).toEqual([{ areaId: 'a1', areaName: 'Area a1' }]);
    expect(plan.warnings.join('\n')).toContain('gone');
  });

  it('truncates long names to 60 characters and rounds to 3 decimals', () => {
    const plan = planAreaTaxBackfill(
      [area({ id: 'a1', defaultTaxRateId: 'r1' })],
      [rate({ id: 'r1', name: 'x'.repeat(80), ratePercent: 8.87549999 })],
    );
    expect(plan.areaUpdates[0].tax).toEqual({ name: 'x'.repeat(60), ratePercent: 8.875 });
  });

  it('is a no-op for areas without the legacy pointer (idempotent re-run)', () => {
    const plan = planAreaTaxBackfill(
      [area({ id: 'a1', tax: { name: 'T', ratePercent: 1 } }), area({ id: 'a2' })],
      [],
    );
    expect(plan.areaUpdates).toEqual([]);
    expect(plan.catalogKeys).toEqual([]);
  });

  it('warns about areas that used to fall back to the account default', () => {
    const plan = planAreaTaxBackfill(
      [area({ id: 'a2' })],
      [rate({ id: 'd', name: 'GA', isDefault: true })],
    );
    expect(plan.warnings.join('\n')).toMatch(/Area a2.*GA/);
  });
});
