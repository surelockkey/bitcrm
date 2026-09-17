import type { DocumentDiscount, DocumentTaxSource, ServiceAreaTax, TaxRate } from "@bitcrm/types";
import { formatMoney } from "@/features/deals/lib";

export { formatMoney };

/** "6%", "6.35%", "8.875%" — at most 3 decimals, no trailing zeros. */
export function formatPercent(n: number | undefined | null): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
  return `${Number(v.toFixed(3))}%`;
}

const SOURCE_LABEL: Record<DocumentTaxSource, string> = {
  service_area: "From the job's service area",
  // Legacy: jobs resolved before taxes moved onto service areas.
  default: "Default tax rate",
  manual: "Set manually",
  exempt: "Client is tax exempt",
  none: "No tax configured",
};

/** Human description of where a document's tax rate came from. */
export function taxSourceLabel(source: DocumentTaxSource | undefined): string {
  return SOURCE_LABEL[source ?? "none"];
}

/** True when the tax was resolved automatically (anything but a manual pick). */
export function isAutoTaxSource(source: DocumentTaxSource | undefined): boolean {
  return source !== undefined && source !== "manual";
}

/** "Name x% · Area" — the label used by every tax-rate picker. */
export function taxRateLabel(
  rate: Pick<TaxRate, "name" | "ratePercent" | "serviceAreaName">,
): string {
  const base = `${rate.name} ${formatPercent(rate.ratePercent)}`;
  return rate.serviceAreaName ? `${base} · ${rate.serviceAreaName}` : base;
}

/** "CT Sales Tax · 6.35%" or "No tax" — a service area's own tax. */
export function serviceAreaTaxLabel(tax: ServiceAreaTax | undefined | null): string {
  return tax ? `${tax.name} · ${formatPercent(tax.ratePercent)}` : "No tax";
}

/** "10%" or "$5.00"; empty string when there's no discount. */
export function discountLabel(d: DocumentDiscount | undefined | null): string {
  if (!d) return "";
  return d.type === "percent" ? formatPercent(d.value) : formatMoney(d.value);
}

/**
 * Turn raw editor input into a discount the API accepts, or `null` when the
 * input means "no discount". Percent is capped at 100; amounts round to cents.
 */
export function normalizeDiscount(
  type: DocumentDiscount["type"],
  raw: string | number,
): DocumentDiscount | null {
  const n = typeof raw === "number" ? raw : raw.trim() === "" ? Number.NaN : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (type === "percent") return { type, value: Math.min(100, Number(n.toFixed(3))) };
  return { type, value: Math.round((n + Number.EPSILON) * 100) / 100 };
}

/** Workiz's tax-exemption reasons, offered as suggestions (free text allowed). */
export const TAX_EXEMPT_REASONS = [
  "Federal government",
  "State/local government",
  "Non-profit",
  "Hospital",
  "Resale",
  "Other",
] as const;
