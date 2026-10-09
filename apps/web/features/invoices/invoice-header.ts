import type { Address, Contact } from "@bitcrm/types";
import { formatPhone } from "@/lib/phone";
import { isYmd } from "@/features/billing/dates";
import { addressKey, contactName } from "@/features/clients/lib";
import { countryOf, stateCode } from "@/features/deals/components/workiz/options";

/*
 * The words of Workiz's invoice header (pg_invoice_wz_01_partial,
 * `header-module`): "Bill to:", "Service address:" and the date box.
 */

/** A day as Workiz's date box writes it: "10/8/2026" (month/day/year, no leading zeros). "" for no day. */
export function formatSlashDate(ymd: string | undefined | null): string {
  if (!isYmd(ymd)) return "";
  const [y, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}/${y}`;
}

/** An address as Workiz's header prints it: the street (and unit) over "City, ST zip". */
export function addressLines(a: Pick<Address, "street" | "unit" | "city" | "state" | "zip">): string[] {
  const street = [a.street, a.unit].map((s) => s?.trim()).filter(Boolean).join(", ");
  const city = [a.city?.trim(), [a.state, a.zip].map((s) => s?.trim()).filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [street, city].filter(Boolean);
}

/** "Bill to:" — the client's name, billing address (else the first one), first phone and first email. */
export function billToLines(contact: Contact | undefined): string[] {
  if (!contact) return [];
  const address = contact.billingAddress ?? contact.addresses?.[0];
  return [
    contactName(contact),
    ...(address ? addressLines(address) : []),
    ...(contact.phones?.[0] ? [formatPhone(contact.phones[0])] : []),
    ...(contact.emails?.[0] ? [contact.emails[0]] : []),
  ].filter(Boolean);
}

/**
 * "Service address:" of a job's invoice: Workiz's "Same as billing address"
 * when the job is where the client is billed, the job's address otherwise.
 */
export function serviceAddressLines(service: Address | undefined, billing: Address | undefined): string[] {
  const lines = service ? addressLines(service) : [];
  if (!lines.length) return [];
  if (billing && sameKey(service!) === sameKey(billing)) return ["Same as billing address"];
  return lines;
}

/** An address's comparison key with its state as a code — imported jobs spell it out ("Connecticut"). */
const sameKey = (a: Address) => addressKey({ ...a, state: stateCode(a.state ?? "", countryOf(a)) });
