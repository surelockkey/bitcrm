import { ClientType, ContactSource, ContactType } from "@bitcrm/types";
import type { Contact, Company } from "@bitcrm/types";

/** E.164 (or a bare US number) → `(404) 555-1234`. Anything else passes through. */
export function formatPhone(raw: string): string {
  if (!raw) return raw;
  const digits = raw.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`;
  return raw;
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
