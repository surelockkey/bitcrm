import { ClientType, ContactSource, ContactType } from "@bitcrm/types";
import type { Contact, Company, Address } from "@bitcrm/types";

// The canonical phone formatter lives in lib/phone; re-exported so existing
// `@/features/clients/lib` imports render the same `+1 404 555 1234` everywhere.
export { formatPhone } from "@/lib/phone";

/** Structured address → single display line, e.g. `123 Main St, Apt 4B, Atlanta, GA 30301`. */
export function formatAddress(a: Address): string {
  const line1 = [a.street, a.unit].filter(Boolean).join(", ");
  const cityLine = [a.city, [a.state, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [line1, cityLine].filter(Boolean).join(", ");
}

/** Normalized comparison key for an address — used to dedupe / detect new ones. */
export function addressKey(a: Pick<Address, "street" | "unit" | "city" | "state" | "zip">): string {
  return [a.street, a.unit ?? "", a.city, a.state, a.zip]
    .map((s) => s.trim().toLowerCase())
    .join("|");
}

/** True when `a` (a non-empty street) already appears in `list`. */
export function addressInList(
  a: Pick<Address, "street" | "unit" | "city" | "state" | "zip">,
  list: Address[] | undefined,
): boolean {
  if (!a.street.trim()) return true; // empty → nothing to save
  const key = addressKey(a);
  return (list ?? []).some((x) => addressKey(x) === key);
}

export function contactName(c: Pick<Contact, "firstName" | "lastName">): string {
  return `${c.firstName} ${c.lastName}`.trim();
}

export const primaryPhone = (c: Pick<Contact | Company, "phones">): string | undefined => c.phones[0];
export const primaryEmail = (c: Pick<Contact | Company, "emails">): string | undefined => c.emails[0];

export function initials(first: string, last: string): string {
  return `${first[0] ?? ""}${last[0] ?? ""}`.toUpperCase();
}

const CLIENT_TYPE: Record<ClientType, string> = {
  [ClientType.RESIDENTIAL]: "Residential",
  [ClientType.COMMERCIAL]: "Commercial",
  [ClientType.GOVERNMENT]: "Government",
};
export const clientTypeLabel = (t: ClientType): string => CLIENT_TYPE[t] ?? t;

const CONTACT_TYPE: Record<ContactType, string> = {
  [ContactType.RESIDENTIAL]: "Residential",
  [ContactType.COMPANY_REPRESENTATIVE]: "Company rep",
};
export const contactTypeLabel = (t: ContactType): string => CONTACT_TYPE[t] ?? t;

const SOURCE: Record<ContactSource, string> = {
  [ContactSource.PHONE_CALL]: "Phone call",
  [ContactSource.EMAIL]: "Email",
  [ContactSource.WEB_FORM]: "Web form",
  [ContactSource.MANUAL]: "Manual",
};
export const sourceLabel = (s: ContactSource): string => SOURCE[s] ?? s;

const onlyDigits = (s: string) => s.replace(/\D/g, "");

/**
 * Client-side search over already-loaded contacts — the list endpoint has no
 * text search. Matches name / title / email substrings, and phone by digits
 * (≥3, formatting-agnostic).
 */
export function searchContacts(list: Contact[], query: string): Contact[] {
  const s = query.trim().toLowerCase();
  if (!s) return list;
  const digits = onlyDigits(query);
  return list.filter((c) => {
    if (contactName(c).toLowerCase().includes(s)) return true;
    if (c.title?.toLowerCase().includes(s)) return true;
    if (c.emails.some((e) => e.toLowerCase().includes(s))) return true;
    if (digits.length >= 3 && c.phones.some((p) => onlyDigits(p).includes(digits))) return true;
    return false;
  });
}

/** Client-side search over companies — title / email / address / phone digits. */
export function searchCompanies(list: Company[], query: string): Company[] {
  const s = query.trim().toLowerCase();
  if (!s) return list;
  const digits = onlyDigits(query);
  return list.filter((c) => {
    if (c.title.toLowerCase().includes(s)) return true;
    if (c.address?.toLowerCase().includes(s)) return true;
    if (c.emails.some((e) => e.toLowerCase().includes(s))) return true;
    if (digits.length >= 3 && c.phones.some((p) => onlyDigits(p).includes(digits))) return true;
    return false;
  });
}
