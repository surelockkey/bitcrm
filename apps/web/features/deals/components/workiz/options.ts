/**
 * Pure option builders behind the data-bound Workiz selects: what each
 * catalog offers, how a value the catalog no longer offers still reads, and
 * the fixed lists (US states, Canadian provinces, Workiz's countries).
 * Shared by the New Job page and the job page's Details tab.
 */

import type { WzOption } from "@/components/workiz";
import type { BusinessProfile, ExternalCompany, ServiceArea } from "@bitcrm/types";
import { DEFAULT_ADDRESS_COUNTRY } from "@bitcrm/types";
import { activeExternalCompanies } from "@/features/external-companies/lib";
import type { EffectiveServiceArea } from "@/features/service-areas/hooks";
import type { QualifiedTech } from "../../api";
import { REASON, techName } from "../tech-suggestions";
import { COUNTRIES } from "./countries";

export { COUNTRIES };

type Named = { id: string; name: string };

/**
 * A catalog (job types, job sources) as options, in the order given — the
 * catalog's own picker order. A current value the catalog no longer offers
 * (archived) goes first, marked, so an old job keeps showing its name.
 */
export function catalogOptions(active: Named[], archived?: Named | null): WzOption[] {
  const rows = active.map((t) => ({ value: t.id, label: t.name }));
  if (archived && !active.some((t) => t.id === archived.id)) {
    rows.unshift({ value: archived.id, label: `${archived.name} (archived)` });
  }
  return rows;
}

/** Enabled external companies by name; a disabled one the job names stays, marked. */
export function externalCompanyOptions(
  all: ExternalCompany[] | undefined,
  value: string | undefined,
): WzOption[] {
  const active = activeExternalCompanies(all);
  const rows: WzOption[] = active.map((c) => ({ value: c.id, label: c.name }));
  if (value && !active.some((c) => c.id === value)) {
    const gone = (all ?? []).find((c) => c.id === value);
    if (gone) rows.unshift({ value: gone.id, label: `${gone.name} (disabled)` });
  }
  return rows;
}

/**
 * Our "Company" (business profile) picker — Workiz has none. Active ones,
 * the default optionally hinted; an archived or deleted selection stays as
 * "(archived)", named from the catalog or the job's snapshot, and only once
 * the catalog has answered (until then nobody knows it is missing).
 */
export function businessProfileOptions({
  data,
  active,
  value,
  showDefaultHint = false,
  fallbackName,
  loading = false,
}: {
  data: BusinessProfile[] | undefined;
  active: BusinessProfile[];
  value: string | null | undefined;
  showDefaultHint?: boolean;
  fallbackName?: string;
  loading?: boolean;
}): WzOption[] {
  const rows: WzOption[] = active.map((c) => ({
    value: c.id,
    label: showDefaultHint && c.isDefault ? `${c.name} (default company)` : c.name,
  }));
  if (value && !active.some((c) => c.id === value)) {
    const name = (data ?? []).find((c) => c.id === value)?.name ?? fallbackName;
    if (name || !loading) rows.unshift({ value, label: `${name ?? "Unknown company"} (archived)` });
  }
  return rows;
}

/** Active areas, priority first then name; an inactive chosen one stays first. */
export function serviceAreaOptions(
  areas: Pick<ServiceArea, "id" | "name" | "priority" | "active">[] | undefined,
  value: string | undefined,
): WzOption[] {
  const list = areas ?? [];
  const active = list
    .filter((a) => a.active)
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name))
    .map((a) => ({ value: a.id, label: a.name }));
  const chosen = value ? list.find((a) => a.id === value && !a.active) : undefined;
  return chosen ? [{ value: chosen.id, label: chosen.name }, ...active] : active;
}

/**
 * What the Service area select shows for the area a job lands in, the way
 * Workiz writes it: "SURE LOCK DALLAS TX (0 miles away)". An address inside
 * the area is 0 miles from it; the nearest-area fallback says how far; a
 * hand-picked area the address is not in is just its name.
 */
export function serviceAreaValueLabel(
  effective: Pick<EffectiveServiceArea, "source" | "area" | "resolvedArea" | "distanceMiles">,
): string | undefined {
  const { source, area } = effective;
  if (!area || !source) return undefined;
  const away = (miles: number) => `${area.name} (${Math.round(miles)} miles away)`;
  if (source === "resolved") return away(0);
  if (source === "nearest") return away(effective.distanceMiles ?? 0);
  return effective.resolvedArea?.id === area.id ? away(0) : area.name;
}

/* ------------------------------------------------------- states, countries */

/** Workiz's State list for the United States (new_04_state_open): 50 + DC, by name. */
export const US_STATES: readonly (readonly [code: string, name: string])[] = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"],
  ["CA", "California"], ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"],
  ["DC", "District of Columbia"], ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"],
  ["ID", "Idaho"], ["IL", "Illinois"], ["IN", "Indiana"], ["IA", "Iowa"],
  ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"], ["ME", "Maine"],
  ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"],
  ["NV", "Nevada"], ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"],
  ["NY", "New York"], ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"],
  ["OK", "Oklahoma"], ["OR", "Oregon"], ["PA", "Pennsylvania"], ["RI", "Rhode Island"],
  ["SC", "South Carolina"], ["SD", "South Dakota"], ["TN", "Tennessee"], ["TX", "Texas"],
  ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"], ["WA", "Washington"],
  ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

/** Canada's provinces and territories, for an address whose Country is Canada. */
export const CA_PROVINCES: readonly (readonly [code: string, name: string])[] = [
  ["AB", "Alberta"], ["BC", "British Columbia"], ["MB", "Manitoba"], ["NB", "New Brunswick"],
  ["NL", "Newfoundland and Labrador"], ["NT", "Northwest Territories"], ["NS", "Nova Scotia"],
  ["NU", "Nunavut"], ["ON", "Ontario"], ["PE", "Prince Edward Island"], ["QC", "Quebec"],
  ["SK", "Saskatchewan"], ["YT", "Yukon"],
];

/** An address's country code; absent or blank is the United States. */
export function countryOf(address: { country?: string } | undefined): string {
  return address?.country?.trim().toUpperCase() || DEFAULT_ADDRESS_COUNTRY;
}

function regionList(country: string | undefined) {
  const c = country?.trim().toUpperCase() || DEFAULT_ADDRESS_COUNTRY;
  return c === "US" ? US_STATES : c === "CA" ? CA_PROVINCES : null;
}

/** The State options for a country: US states, Canadian provinces, or none (typed). */
export function stateOptions(country: string | undefined): WzOption[] {
  return (regionList(country) ?? []).map(([value, label]) => ({ value, label }));
}

/**
 * A state as its code, however it was written: Google gives "TX", imports
 * and hands give "Texas" or "tx". Outside the US and Canada it stays as typed.
 */
export function stateCode(value: string, country: string | undefined): string {
  const list = regionList(country);
  const v = value.trim();
  if (!list || !v) return list ? v : value;
  const lower = v.toLowerCase();
  const hit = list.find(([code, name]) => code.toLowerCase() === lower || name.toLowerCase() === lower);
  return hit ? hit[0] : v;
}

/** Workiz's Country options (249, its order and spelling), valued by ISO code. */
export function countryOptions(): WzOption[] {
  return COUNTRIES.map(([value, label]) => ({ value, label }));
}

/* -------------------------------------------------------------------- team */

/**
 * "Assign team members": the techs who can take the job are pickable; the
 * rest stay listed, disabled, with why (as our picker always showed them).
 * Someone already on the job but not on the list (an imported tech with no
 * approved job types) is kept, named from the directory.
 */
export function teamOptions(
  techs: QualifiedTech[],
  selected: string[],
  directoryName: (id: string) => string | undefined,
): WzOption[] {
  const rows: WzOption[] = techs.map((t) =>
    t.eligible
      ? { value: t.id, label: techName(t) }
      : {
          value: t.id,
          label: `${techName(t)} (${REASON[t.reasons[0]] ?? "not eligible"})`,
          disabled: true,
        },
  );
  for (const id of selected) {
    if (!techs.some((t) => t.id === id)) rows.push({ value: id, label: directoryName(id) ?? "Technician" });
  }
  return rows;
}

export type TeamNotice =
  | { kind: "no-area" }
  | { kind: "count"; count: number; area: string; jobType: string | null };

/**
 * The line under the team select. Workiz: "Please select a service area to
 * display available techs" until there is an area, then "2 techs work in
 * SURE LOCK DALLAS TX and can perform any job type" (or the job type's name).
 */
export function teamNotice({
  hasArea,
  areaName,
  count = 0,
  jobTypeName,
}: {
  hasArea: boolean;
  areaName?: string;
  count?: number;
  jobTypeName?: string | null;
}): TeamNotice {
  if (!hasArea) return { kind: "no-area" };
  return { kind: "count", count, area: areaName ?? "", jobType: jobTypeName || null };
}
