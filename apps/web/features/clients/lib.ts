import { ClientType, ContactSource, ContactType, PaymentTerms } from "@bitcrm/types";
import type { Contact, Company, Address } from "@bitcrm/types";

// The canonical phone formatter lives in lib/phone; re-exported so existing
// `@/features/clients/lib` imports render the same `+1 404 555 1234` everywhere.
import { formatPhone } from "@/lib/phone";
export { formatPhone };

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

/* ---- Duplicate detection for the merge flow ---- */

export type DuplicateCriterion = "phone" | "address" | "name";

export interface DuplicateGroup {
  key: string;
  label: string;
  contacts: Contact[];
}

/** US-leaning canonical phone key: bare digits with a leading country "1" dropped. */
const phoneKey = (p: string): string => {
  const digits = onlyDigits(p);
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
};

/**
 * Duplicate detection over already-loaded contacts (the list endpoint has no
 * server-side search, mirroring `searchContacts`). Keys every contact by the
 * chosen criterion and returns the keys shared by 2+ contacts. A contact may
 * appear in several groups (one per shared phone/address) but never pairs
 * with itself.
 */
export function findDuplicateGroups(list: Contact[], by: DuplicateCriterion): DuplicateGroup[] {
  const groups = new Map<string, DuplicateGroup>();

  const add = (key: string, label: string, c: Contact) => {
    if (!key) return;
    let g = groups.get(key);
    if (!g) {
      g = { key, label, contacts: [] };
      groups.set(key, g);
    }
    if (!g.contacts.some((x) => x.id === c.id)) g.contacts.push(c);
  };

  for (const c of list) {
    if (by === "phone") {
      for (const p of c.phones) add(phoneKey(p), formatPhone(p), c);
    } else if (by === "address") {
      for (const a of c.addresses) add(addressKey(a), formatAddress(a), c);
    } else {
      const name = contactName(c);
      add(name.toLowerCase().replace(/\s+/g, " "), name, c);
    }
  }

  return [...groups.values()].filter((g) => g.contacts.length >= 2);
}

/* ---- Platinum client financial terms & compliance (EPIC-9) ---- */

export type CoiStatus = "none" | "valid" | "expiring" | "expired";

/** COI status derived from its expiry date; "expiring" ≤ 30 days out. */
export function coiStatus(coiExpiration: string | undefined, now = new Date()): CoiStatus {
  if (!coiExpiration) return "none";
  const expiry = Date.parse(`${coiExpiration}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const days = Math.round((expiry - today) / 86_400_000);
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "valid";
}

const NET_DAYS: Record<PaymentTerms, number> = {
  [PaymentTerms.CASH]: 0,
  [PaymentTerms.NET_15]: 15,
  [PaymentTerms.NET_30]: 30,
  [PaymentTerms.NET_60]: 60,
  [PaymentTerms.CUSTOM]: 0,
};

export function paymentTermsLabel(terms?: PaymentTerms, customDays?: number): string {
  if (!terms) return "—";
  if (terms === PaymentTerms.CASH) return "Cash";
  if (terms === PaymentTerms.CUSTOM) return `Net-${customDays ?? "?"} (custom)`;
  return `Net-${NET_DAYS[terms]}`;
}

/** Invoice due date = invoice date + the terms' net days ("YYYY-MM-DD"). */
export function dueDateFrom(invoiceDate: string, terms?: PaymentTerms, customDays?: number): string {
  const net = !terms
    ? 0
    : terms === PaymentTerms.CUSTOM
      ? customDays ?? 0
      : NET_DAYS[terms];
  const due = Date.parse(`${invoiceDate}T00:00:00Z`) + net * 86_400_000;
  return new Date(due).toISOString().slice(0, 10);
}
