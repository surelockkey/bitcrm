import type { ExternalCompany } from "@bitcrm/types";
import { useExternalCompanies } from "./hooks";

/** Build an id → name lookup from the catalog list. */
export function externalCompanyNameMap(
  companies: ExternalCompany[] | undefined,
): Map<string, string> {
  return new Map((companies ?? []).map((c) => [c.id, c.name]));
}

/**
 * Resolve an external-company id to its display name. Falls back to the raw id
 * (rather than an empty cell) so a job referencing a purged company still shows
 * something.
 */
export function externalCompanyName(
  id: string | undefined,
  companies: ExternalCompany[] | undefined,
): string {
  if (!id) return "—";
  return externalCompanyNameMap(companies).get(id) ?? id;
}

/** Hook wrapper for components that only need the resolver. */
export function useExternalCompanyName(): (id: string | undefined) => string {
  const { data } = useExternalCompanies();
  return (id) => externalCompanyName(id, data);
}

/** Enabled companies only, sorted for pickers. */
export function activeExternalCompanies(
  companies: ExternalCompany[] | undefined,
): ExternalCompany[] {
  return (companies ?? [])
    .filter((c) => c.active)
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A query made only of digits and phone punctuation, with 4+ digits. */
const PHONE_QUERY = /^[\d\s().+\-–—]+$/;

/**
 * Free-text search over the settings list: name, email and address match as
 * substrings; a phone-shaped query matches digit-to-digit, so "(855) 281-0219",
 * "8552810219" and a "0219" fragment all find the same row.
 */
export function searchExternalCompanies(
  companies: ExternalCompany[] | undefined,
  query: string,
): ExternalCompany[] {
  const all = (companies ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
  const q = query.trim().toLowerCase();
  if (!q) return all;

  const qDigits = PHONE_QUERY.test(q) ? q.replace(/\D/g, "") : "";
  const qIsPhone = qDigits.length >= 4;

  return all.filter((c) => {
    if (c.name.toLowerCase().includes(q)) return true;
    if ((c.email ?? "").toLowerCase().includes(q)) return true;
    if ((c.address ?? "").toLowerCase().includes(q)) return true;
    if ((c.phone ?? "").toLowerCase().includes(q)) return true;
    if (qIsPhone) {
      const digits = (c.phone ?? "").replace(/\D/g, "");
      if (digits.length >= 4 && digits.includes(qDigits)) return true;
    }
    return false;
  });
}

/** A column of Workiz's companies grid that sorts. */
export type ExternalCompanySortKey = "name" | "email" | "address" | "phone" | "status";

const SORT_VALUE: Record<ExternalCompanySortKey, (c: ExternalCompany) => string> = {
  name: (c) => c.name,
  email: (c) => c.email ?? "",
  address: (c) => c.address ?? "",
  phone: (c) => c.phone ?? "",
  // As the Status column prints it: "Disabled" sorts before "Enabled".
  status: (c) => (c.active ? "Enabled" : "Disabled"),
};

/**
 * The companies in the header's order (Workiz's DataTables grid): words
 * case-blind, numbers in them as numbers, blanks last either way. A copy.
 */
export function sortExternalCompanies(
  companies: readonly ExternalCompany[],
  sort: { key: ExternalCompanySortKey; dir: "asc" | "desc" },
): ExternalCompany[] {
  const value = SORT_VALUE[sort.key];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...companies].sort((a, b) => {
    const va = value(a).trim();
    const vb = value(b).trim();
    if (!va || !vb) return !va === !vb ? 0 : !va ? 1 : -1;
    return va.localeCompare(vb, "en", { numeric: true, sensitivity: "base" }) * sign;
  });
}
