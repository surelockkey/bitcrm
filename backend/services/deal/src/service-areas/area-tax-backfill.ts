import { effectiveTaxRatePercent, type ServiceAreaTax, type TaxRate } from '@bitcrm/types';

/**
 * Pure planning for `backfill-area-taxes` (Revision 2: taxes live ON service
 * areas). Kept free of I/O so it is unit-testable; the script does the reads
 * and writes.
 */

type RawItem = Record<string, unknown>;

export interface AreaTaxUpdate {
  areaId: string;
  areaName: string;
  /** Absent → the area already has a tax (or its rate is gone): only drop the pointer. */
  tax?: ServiceAreaTax;
}

export interface AreaTaxBackfillPlan {
  /** Every area that still carries the legacy `defaultTaxRateId`. */
  areaUpdates: AreaTaxUpdate[];
  /** Keys of the legacy `TAX_RATE#` catalog rows (deleted only with `--delete-catalog`). */
  catalogKeys: Array<{ PK: string; SK: string }>;
  warnings: string[];
}

const NAME_MAX = 60;

function toRate(item: RawItem): TaxRate {
  return {
    id: (item.id as string) ?? String(item.PK).replace(/^TAX_RATE#/, ''),
    name: String(item.name ?? ''),
    ratePercent: Number(item.ratePercent ?? 0),
    isDefault: Boolean(item.isDefault),
    active: item.active !== false,
    isGroup: Boolean(item.isGroup),
    componentIds: (item.componentIds as string[]) ?? [],
    createdBy: String(item.createdBy ?? ''),
    createdAt: String(item.createdAt ?? ''),
    updatedAt: String(item.updatedAt ?? ''),
  };
}

export function planAreaTaxBackfill(areaItems: RawItem[], rateItems: RawItem[]): AreaTaxBackfillPlan {
  const rates = rateItems.map(toRate);
  const byId = new Map(rates.map((r) => [r.id, r]));
  const accountDefault = rates.find((r) => r.isDefault && r.active);
  const plan: AreaTaxBackfillPlan = {
    areaUpdates: [],
    catalogKeys: rateItems.map((i) => ({ PK: String(i.PK), SK: String(i.SK ?? 'METADATA') })),
    warnings: [],
  };

  for (const item of areaItems) {
    const areaId = (item.id as string) ?? String(item.PK).replace(/^SERVICE_AREA#/, '');
    const areaName = String(item.name ?? areaId);
    const pointer = item.defaultTaxRateId as string | undefined;

    if (!pointer) {
      if (!item.tax && accountDefault) {
        plan.warnings.push(
          `${areaName} (${areaId}) has no tax; its jobs used to fall back to the account default ` +
            `"${accountDefault.name}" (${accountDefault.ratePercent}%) — set a tax on the area if that is still wanted.`,
        );
      }
      continue;
    }

    if (item.tax) {
      plan.areaUpdates.push({ areaId, areaName });
      continue;
    }

    const rate = byId.get(pointer);
    if (!rate) {
      plan.warnings.push(`${areaName} (${areaId}) pointed at missing tax rate ${pointer}; pointer removed, no tax set.`);
      plan.areaUpdates.push({ areaId, areaName });
      continue;
    }

    const percent = Math.round(effectiveTaxRatePercent(rate, rates) * 1000) / 1000;
    plan.areaUpdates.push({
      areaId,
      areaName,
      tax: { name: rate.name.trim().slice(0, NAME_MAX) || 'Sales tax', ratePercent: percent },
    });
  }

  return plan;
}
