import { Injectable, Logger } from '@nestjs/common';
import { type Deal, type DocumentTaxSource, type TaxRate } from '@bitcrm/types';
import { InternalHttpService } from '../../common/services/internal-http.service';
import { ServiceAreasService } from '../../service-areas/service-areas.service';
import { taxRateFromArea } from '../../tax-rates/tax-rates.service';

/**
 * The tax fields a deal carries. `null` (not undefined) so the value can be fed
 * straight into `DealsRepository.update`, where null REMOVEs the attribute.
 */
export interface DealTaxSnapshot {
  taxSource: DocumentTaxSource;
  taxRateId: string | null;
  taxRateName: string | null;
  taxRatePercent: number | null;
}

const NO_RATE = { taxRateId: null, taxRateName: null, taxRatePercent: null };

/**
 * Picks a job's tax rate: a tax-exempt client (contact OR company) → no tax;
 * else the job's service area's own `tax` (rate id = area id); else none.
 * There is no account default. Name and percent are snapshotted so a later
 * edit of the area's tax never silently re-prices the job.
 */
@Injectable()
export class DealTaxResolver {
  private readonly logger = new Logger(DealTaxResolver.name);

  constructor(
    private readonly internalHttp: InternalHttpService,
    private readonly serviceAreas: ServiceAreasService,
  ) {}

  async resolve(input: {
    contactId: string;
    companyId?: string;
    serviceAreaId?: string;
  }): Promise<DealTaxSnapshot> {
    if (await this.isExempt(input.contactId, input.companyId)) {
      return { taxSource: 'exempt', ...NO_RATE };
    }

    const areaRate = await this.serviceAreaRate(input.serviceAreaId);
    if (areaRate) return this.snapshotOf(areaRate, 'service_area');

    return { taxSource: 'none', ...NO_RATE };
  }

  /** Snapshot a specific rate. */
  snapshotOf(rate: TaxRate, taxSource: DocumentTaxSource): DealTaxSnapshot {
    return {
      taxSource,
      taxRateId: rate.id,
      taxRateName: rate.name,
      taxRatePercent: rate.ratePercent,
    };
  }

  /** The deal's current tax, in snapshot shape (for timeline from→to). */
  static fromDeal(deal: Partial<Deal>): DealTaxSnapshot {
    return {
      taxSource: deal.taxSource ?? 'none',
      taxRateId: deal.taxRateId ?? null,
      taxRateName: deal.taxRateName ?? null,
      taxRatePercent: deal.taxRatePercent ?? null,
    };
  }

  static sameTax(a: DealTaxSnapshot, b: DealTaxSnapshot): boolean {
    return (
      a.taxSource === b.taxSource &&
      a.taxRateId === b.taxRateId &&
      a.taxRateName === b.taxRateName &&
      a.taxRatePercent === b.taxRatePercent
    );
  }

  /** Snapshot without the nulls — for a brand-new deal item. */
  static forCreate(snapshot: DealTaxSnapshot): Partial<Deal> {
    const out: Partial<Deal> = { taxSource: snapshot.taxSource };
    if (snapshot.taxRateId !== null) out.taxRateId = snapshot.taxRateId;
    if (snapshot.taxRateName !== null) out.taxRateName = snapshot.taxRateName;
    if (snapshot.taxRatePercent !== null) out.taxRatePercent = snapshot.taxRatePercent;
    return out;
  }

  /**
   * A CRM outage must not block creating or editing a job, so a failed read is
   * logged and treated as "not exempt" — the dispatcher can still set the tax
   * by hand.
   */
  private async isExempt(contactId: string, companyId?: string): Promise<boolean> {
    try {
      const contact = await this.internalHttp.getContact(contactId);
      if (contact?.taxExempt) return true;
      const cid = companyId ?? contact?.companyId;
      if (!cid) return false;
      const company = await this.internalHttp.getCompany(cid);
      return Boolean(company?.taxExempt);
    } catch (err) {
      this.logger.warn(
        `Tax exemption lookup failed for contact ${contactId}: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private async serviceAreaRate(serviceAreaId?: string): Promise<TaxRate | null> {
    if (!serviceAreaId) return null;
    try {
      return taxRateFromArea(await this.serviceAreas.findById(serviceAreaId));
    } catch {
      // Area deleted since — the job simply carries no tax.
      return null;
    }
  }
}
