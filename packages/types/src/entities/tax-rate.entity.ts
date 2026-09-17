/**
 * A selectable tax rate. Rates are configured on service areas (one per area)
 * and exposed in this shape, with `id === serviceAreaId`, so jobs, estimates
 * and invoices can snapshot/choose them. A job/estimate/invoice carries exactly
 * one rate; lines only carry a `taxable` flag. `isGroup`/`componentIds`/
 * `isDefault` are kept for shape compatibility and are always false/empty.
 */
export interface TaxRate {
  /** The service area that owns this rate. */
  serviceAreaId?: string;
  serviceAreaName?: string;
  id: string;
  name: string;
  /** Percent, e.g. 6.35. For a group this is the stored sum at write time. */
  ratePercent: number;
  /** At most one active rate is the account default. */
  isDefault: boolean;
  active: boolean;
  isGroup: boolean;
  /** Component (non-group) rate ids when `isGroup`. */
  componentIds: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
