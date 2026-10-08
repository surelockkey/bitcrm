/**
 * The New Job page's client, Workiz's way: one "Client name" box, a free-text
 * "Company name", Phone | Ext rows and an Email — and how that maps onto our
 * CRM, where a client has a first and a last name and a company is a record.
 */

import {
  ClientType,
  ContactSource,
  ContactType,
  type Address,
  type Company,
  type Contact,
} from "@bitcrm/types";
import type { ClientEdits } from "@/features/clients/components/client-change-dialog";
import type { CreateContactValues, UpdateContactValues } from "@/features/clients/schemas";
import { contactName } from "@/features/clients/lib";

export interface ClientPhoneRow {
  /** E.164 once typed in full ("+14045550123"), "" while empty. */
  phone: string;
  ext: string;
}

/** What the Client Details card holds. */
export interface ClientForm {
  name: string;
  company: string;
  /** One row, two once "Add phone" was used (Workiz offers one more). */
  phones: ClientPhoneRow[];
  email: string;
}

/** Workiz's "Add phone" adds one more row; then the link goes away. */
export const MAX_CLIENT_PHONES = 2;

/**
 * "Client name" as our first and last name: the first word, then the rest
 * ("" for one word) — what imported Workiz clients look like.
 */
export function splitClientName(name: string): { firstName: string; lastName: string } {
  const t = name.trim();
  const at = t.search(/\s/);
  if (at < 0) return { firstName: t, lastName: "" };
  return { firstName: t.slice(0, at), lastName: t.slice(at).trim() };
}

/** The CRM company a typed "Company name" means: same title, any case. */
export function matchCompany(companies: Company[] | undefined, title: string): Company | undefined {
  const t = title.trim().toLowerCase();
  if (!t) return undefined;
  return (companies ?? []).find((c) => c.title.trim().toLowerCase() === t);
}

/**
 * The job's client type, which Workiz never asks for: a company's own type,
 * else commercial when a company name was given, else residential.
 */
export function jobClientType(company: Pick<Company, "clientType"> | undefined, companyName: string): ClientType {
  if (company?.clientType) return company.clientType;
  return companyName.trim() ? ClientType.COMMERCIAL : ClientType.RESIDENTIAL;
}

export function emptyClientForm(phone = ""): ClientForm {
  return { name: "", company: "", phones: [{ phone, ext: "" }], email: "" };
}

/** A picked client as the card shows them (their first two numbers). */
export function clientFormFromContact(contact: Contact, companyTitle: string | undefined): ClientForm {
  const shown = contact.phones.slice(0, MAX_CLIENT_PHONES);
  return {
    name: contactName(contact),
    company: companyTitle ?? "",
    phones: shown.length
      ? shown.map((phone) => ({ phone, ext: contact.phoneExtensions?.[phone] ?? "" }))
      : [{ phone: "", ext: "" }],
    email: contact.emails[0] ?? "",
  };
}

function extensions(rows: ClientPhoneRow[], base: Record<string, string> = {}, keep: string[] = []) {
  const map: Record<string, string> = {};
  for (const p of keep) if (base[p]) map[p] = base[p];
  for (const r of rows) {
    if (!r.phone) continue;
    if (r.ext.trim()) map[r.phone] = r.ext.trim();
    else delete map[r.phone];
  }
  return Object.keys(map).length ? map : undefined;
}

/** The POST /crm/contacts body for a client typed in on this page. */
export function newContactBody(
  form: ClientForm,
  { companyId, address }: { companyId?: string; address?: Address },
): CreateContactValues {
  const { firstName, lastName } = splitClientName(form.name);
  const phones = form.phones.map((r) => r.phone).filter(Boolean);
  const email = form.email.trim();
  return {
    firstName,
    lastName,
    phones,
    phoneExtensions: extensions(form.phones),
    emails: email ? [email] : [],
    addresses: address?.street?.trim() ? [address] : [],
    companyId,
    type: companyId ? ContactType.COMPANY_REPRESENTATIVE : ContactType.RESIDENTIAL,
    source: ContactSource.PHONE_CALL,
  };
}

/** The parts of a client update that need no question asked. */
export type ClientExtras = Pick<UpdateContactValues, "phones" | "phoneExtensions" | "emails" | "companyId" | "type">;

/**
 * What the dispatcher changed on a picked client.
 *
 * A new name or main number is ambiguous — a correction, or somebody else on
 * their line — so it is the question ClientSaveDialog asks (`asks`, with the
 * `edits` it shows). An email, an extension, another number or the company
 * are plain corrections, written to the client with the job (`extras`, the
 * full lists to send, or null when nothing moved). Numbers past the two the
 * card shows, and emails past the first, are kept.
 */
export function pickedClientChanges(
  contact: Contact,
  form: ClientForm,
  companyId: string | undefined,
): { edits: ClientEdits; asks: boolean; extras: ClientExtras | null } {
  const nameChanged = form.name.trim() !== contactName(contact);
  const main = form.phones[0]?.phone ?? "";
  const phoneChanged = !!main && main !== contact.phones[0];
  const split = splitClientName(form.name);
  const edits: ClientEdits = {
    firstName: nameChanged ? split.firstName : contact.firstName,
    lastName: nameChanged ? split.lastName : contact.lastName,
    phone: main || contact.phones[0] || "",
  };

  const shown = form.phones.map((r) => r.phone).filter(Boolean);
  const rest = contact.phones.slice(MAX_CLIENT_PHONES).filter((p) => !shown.includes(p));
  const phones = [...shown, ...rest];
  const phoneExtensions = extensions(form.phones, contact.phoneExtensions, phones);
  const email = form.email.trim();
  const emails =
    email === (contact.emails[0] ?? "")
      ? contact.emails
      : [...(email ? [email] : []), ...contact.emails.slice(1)];

  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  const changed =
    !same(phones, contact.phones) ||
    !same(phoneExtensions, extensions([], contact.phoneExtensions, contact.phones)) ||
    !same(emails, contact.emails) ||
    (companyId ?? null) !== (contact.companyId ?? null);

  return {
    edits,
    asks: nameChanged || phoneChanged,
    extras: changed
      ? {
          phones,
          phoneExtensions,
          emails,
          companyId,
          type: companyId ? ContactType.COMPANY_REPRESENTATIVE : ContactType.RESIDENTIAL,
        }
      : null,
  };
}
