import type { BusinessProfile } from "@bitcrm/types";

/** Active companies for pickers: default first, then by name. */
export function activeCompanies<T extends BusinessProfile>(list: T[] | undefined): T[] {
  return (list ?? [])
    .filter((c) => c.active)
    .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

/** The account's default company (or the first active one while none is flagged). */
export function defaultCompany<T extends BusinessProfile>(list: T[] | undefined): T | undefined {
  return (list ?? []).find((c) => c.isDefault && c.active) ?? activeCompanies(list)[0];
}

/**
 * Which company a new job starts with: an explicit `?companyId=` wins, then
 * the service area's default company (when it's still active), then the
 * account default.
 */
export function pickPrefillCompanyId({
  queryId,
  areaDefaultId,
  companies,
}: {
  queryId?: string | null;
  areaDefaultId?: string | null;
  companies: BusinessProfile[] | undefined;
}): string | undefined {
  if (queryId) return queryId;
  if (areaDefaultId && companies?.some((c) => c.id === areaDefaultId && c.active)) return areaDefaultId;
  return defaultCompany(companies)?.id;
}
