import { Injectable, NotFoundException } from '@nestjs/common';
import { type ServiceArea, type TaxRate } from '@bitcrm/types';
import { ServiceAreasService } from '../service-areas/service-areas.service';

/**
 * The `TaxRate` view of a service area's own tax, or null when the area has
 * none. The id IS the area id, so a job/estimate that snapshots it can always
 * be traced back to the market it came from.
 */
export function taxRateFromArea(area: ServiceArea): TaxRate | null {
  if (!area.tax) return null;
  return {
    id: area.id,
    name: area.tax.name,
    ratePercent: area.tax.ratePercent,
    active: area.active,
    isDefault: false,
    isGroup: false,
    componentIds: [],
    serviceAreaId: area.id,
    serviceAreaName: area.name,
    createdBy: area.createdBy,
    createdAt: area.createdAt,
    updatedAt: area.updatedAt,
  };
}

/**
 * Read-only tax rates, DERIVED from service areas (Revision 2): there is no
 * catalog and no account default any more. Every area that carries a `tax`
 * contributes one rate (`id === serviceAreaId`). Jobs, estimates and invoices
 * snapshot name + percent, so editing an area's tax never re-prices them.
 */
@Injectable()
export class TaxRatesService {
  constructor(private readonly serviceAreas: ServiceAreasService) {}

  /** By name (then area name). Archived areas' rates only on request. */
  async list(opts: { includeInactive?: boolean } = {}): Promise<TaxRate[]> {
    const areas = await this.serviceAreas.list();
    return areas
      .map(taxRateFromArea)
      .filter((r): r is TaxRate => r !== null && (Boolean(opts.includeInactive) || r.active))
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          (a.serviceAreaName ?? '').localeCompare(b.serviceAreaName ?? ''),
      );
  }

  /** Every rate, archived areas included (internal readers, snapshots). */
  async listAll(): Promise<TaxRate[]> {
    return this.list({ includeInactive: true });
  }

  async findById(id: string): Promise<TaxRate> {
    const rate = await this.findOptional(id);
    if (!rate) throw new NotFoundException(`Tax rate ${id} not found`);
    return rate;
  }

  /** The rate for an area id, or null (unknown area, or an area without a tax). */
  async findOptional(id: string): Promise<TaxRate | null> {
    try {
      return taxRateFromArea(await this.serviceAreas.findById(id));
    } catch (err) {
      if (err instanceof NotFoundException) return null;
      throw err;
    }
  }
}
