import type { TaxRate } from "@bitcrm/types";
import { http } from "@/lib/api/http";

/**
 * Read-only: taxes are configured on service areas, and the deal service
 * derives one selectable `TaxRate` per area (`id === serviceAreaId`).
 * Inactive areas included — pickers filter to active ones locally.
 */
export const listTaxRates = (): Promise<TaxRate[]> =>
  http.get<TaxRate[]>("/deals/tax-rates?includeInactive=true");
