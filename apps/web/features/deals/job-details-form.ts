/**
 * The rules behind the job page's Details form (Workiz layout): what the
 * one-line address box says, how the Phone | Ext rows behave, what the single
 * Save writes, and how the Team list changes. Pure, so the component only
 * draws.
 */

import { DEFAULT_ADDRESS_COUNTRY } from "@bitcrm/types";
import type { Address, Company, Contact, Deal } from "@bitcrm/types";
import { addressInList } from "@/features/clients/lib";
import type { UpdateContactValues } from "@/features/clients/schemas";
import { isValidPhone } from "@/lib/phone";
import type { ClientSaveDecision } from "./components/change-client-dialog";
import { CA_PROVINCES, COUNTRIES, US_STATES } from "./components/workiz/options";
import { buildContactBody, buildDealPatch, type ClientDraft, type DealDraft } from "./lib";
import type { UpdateDealValues } from "./schemas";

/* ------------------------------------------------------------ address box */

function regionName(state: string, country: string): string {
  const list = country === "US" ? US_STATES : country === "CA" ? CA_PROVINCES : null;
  const v = state.trim();
  if (!list || !v) return v;
  const hit = list.find(([code]) => code.toLowerCase() === v.toLowerCase());
  return hit ? hit[1] : v;
}

/**
 * The address as Workiz's box writes it (job_b_01_details:
 * "Princeton, Princeton, Texas 75407"): street, unit, city, the state in
 * full and the zip; the country only when it is not the United States.
 */
export function addressSummary(a: Address | undefined): string {
  if (!a) return "";
  const country = a.country?.trim().toUpperCase() || DEFAULT_ADDRESS_COUNTRY;
  const region = [regionName(a.state ?? "", country), a.zip?.trim()].filter(Boolean).join(" ");
  const parts = [a.street?.trim(), a.unit?.trim(), a.city?.trim(), region].filter(Boolean);
  if (parts.length && country !== DEFAULT_ADDRESS_COUNTRY) {
    parts.push(COUNTRIES.find(([code]) => code === country)?.[1] ?? country);
  }
  return parts.join(", ");
}

/* -------------------------------------------------------------- phone rows */

export interface PhoneRow {
  /** Row in the draft. */
  index: number;
  value: string;
  ext: string;
  /** The number the job was created with: never edited or removed here. */
  locked: boolean;
  removable: boolean;
  /** Where the number sits on the client record (-1: not saved yet) — the call button dials that one. */
  fileIndex: number;
}

/**
 * One Phone | Ext row per draft number. The first number on file is bound to
 * the job for good; any other row can go while at least one stays.
 */
export function phoneRows(onFile: string[], draft: ClientDraft): PhoneRow[] {
  return draft.phones.map((value, index) => {
    const locked = index === 0 && onFile.length > 0;
    return {
      index,
      value,
      ext: draft.phoneExts[index] ?? "",
      locked,
      removable: !locked && draft.phones.length > 1,
      fileIndex: value ? onFile.indexOf(value) : -1,
    };
  });
}

/** Workiz's "Add Phone": one more empty row. */
export function addPhoneRow(draft: ClientDraft): ClientDraft {
  return { ...draft, phones: [...draft.phones, ""], phoneExts: [...draft.phones.map((_, i) => draft.phoneExts[i] ?? ""), ""] };
}

/** Drop a row and the extension typed against it. */
export function removePhoneRow(draft: ClientDraft, index: number): ClientDraft {
  return {
    ...draft,
    phones: draft.phones.filter((_, i) => i !== index),
    phoneExts: draft.phones.map((_, i) => draft.phoneExts[i] ?? "").filter((_, i) => i !== index),
  };
}

/* ------------------------------------------------------------------- save */

export interface DetailsSaveInput {
  deal: Deal;
  /**
   * Workiz's "Company name": what the box started with (the client's company,
   * else the job's own record of it) and what it says now.
   */
  company?: { base: string; typed: string };
  /** Undefined until the client has loaded. */
  contact: Contact | undefined;
  dealDraft: DealDraft;
  clientDraft: ClientDraft | null;
  /** `contacts.edit`: without it nothing here ever writes the client. */
  canEditClient: boolean;
}

export interface DetailsSavePlan {
  dealPatch: UpdateDealValues | null;
  /** First/Last Name differ from what the job shows (its own name for the client, else the contact's). */
  nameChanged: boolean;
  /** The job's address, when it changed and the client does not have it on file. */
  newAddress?: Address;
  /** The contact PUT as it stands before the "Change client" answer. */
  contactBody: UpdateContactValues | null;
  dirty: boolean;
  /** Save must ask first: a rename, or an address the client could keep. */
  ask: boolean;
  /** Every phone row is empty or a whole number. */
  phonesOk: boolean;
  /** The Company name box says something else now (contacts.edit only). */
  companyChanged: boolean;
}

/**
 * What the single Save would write. A rename is measured against what the
 * job shows (its "Just here" name, else the contact's), so a job imported
 * with its own name for the client opens clean. Phones and the email live on
 * the client record alone and save straight through; only a rename or a new
 * address asks.
 */
export function planDetailsSave({ deal, contact, dealDraft, clientDraft, canEditClient, company }: DetailsSaveInput): DetailsSavePlan {
  const dealPatch = buildDealPatch(deal, dealDraft);
  const baseFirst = deal.clientName?.firstName ?? contact?.firstName ?? "";
  const baseLast = deal.clientName?.lastName ?? contact?.lastName ?? "";
  const nameChanged =
    !!contact &&
    !!clientDraft &&
    (clientDraft.firstName.trim() !== baseFirst || clientDraft.lastName.trim() !== baseLast);
  const newAddress =
    contact && dealPatch?.address && !addressInList(dealDraft.address, contact.addresses)
      ? dealDraft.address
      : undefined;
  const contactBody =
    canEditClient && contact && clientDraft
      ? buildContactBody(contact, clientDraft, dealPatch?.address ? dealDraft.address : undefined, {
          includeName: nameChanged,
        })
      : null;
  const companyChanged =
    canEditClient && !!contact && !!company && company.typed.trim() !== company.base.trim();
  return {
    dealPatch,
    nameChanged,
    newAddress,
    contactBody,
    companyChanged,
    dirty: !!dealPatch || !!contactBody || (canEditClient && nameChanged) || companyChanged,
    ask: canEditClient && !!contact && (nameChanged || !!newAddress),
    phonesOk: !clientDraft || clientDraft.phones.every((p) => !p.trim() || isValidPhone(p)),
  };
}

/**
 * The writes once the question (if any) is answered. "Just here" pins the
 * new name to this job; "Yes, make change" writes it to the client and drops
 * a stale per-job name. A new client is never made from here.
 */
export function commitDetailsSave(
  input: DetailsSaveInput,
  decision: ClientSaveDecision,
): { dealPatch: UpdateDealValues | null; contactBody: UpdateContactValues | null } {
  const { deal, contact, clientDraft, canEditClient } = input;
  const plan = planDetailsSave(input);
  const renaming = canEditClient && !!contact && !!clientDraft && plan.nameChanged;
  const override: Partial<UpdateDealValues> = !renaming
    ? {}
    : decision.applyToClient
      ? deal.clientName
        ? { clientName: null }
        : {}
      : { clientName: { firstName: clientDraft!.firstName.trim(), lastName: clientDraft!.lastName.trim() } };
  const patch = { ...(plan.dealPatch ?? {}), ...override };
  const contactBody =
    canEditClient && contact && clientDraft
      ? buildContactBody(contact, clientDraft, decision.address === "save" ? plan.newAddress : undefined, {
          includeName: plan.nameChanged && decision.applyToClient,
        })
      : null;
  return { dealPatch: Object.keys(patch).length ? patch : null, contactBody };
}

/* ----------------------------------------------------------- company name */

export type CompanyResolution =
  | { kind: "keep" }
  | { kind: "clear" }
  | { kind: "link"; id: string }
  | { kind: "create"; title: string };

/**
 * What a typed "Company name" means for the client's CRM company — the same
 * reading the New Job page gives it: the client's own company while the box
 * still says its name, nothing once emptied, a company with that title (any
 * case) when one exists, else a new one.
 */
export function resolveCompanyName({
  typed,
  currentId,
  currentTitle,
  companies,
}: {
  typed: string;
  currentId: string | undefined;
  currentTitle: string;
  companies: Pick<Company, "id" | "title">[] | undefined;
}): CompanyResolution {
  const title = typed.trim();
  if (!title) return { kind: "clear" };
  if (currentId && title.toLowerCase() === currentTitle.trim().toLowerCase()) return { kind: "keep" };
  const hit = (companies ?? []).find((c) => c.title.trim().toLowerCase() === title.toLowerCase());
  return hit ? { kind: "link", id: hit.id } : { kind: "create", title };
}

/**
 * The contact PUT (it replaces, not merges) carrying a new company: the
 * body the other edits made, else the contact as it is.
 */
export function contactBodyWithCompany(
  c: Contact,
  body: UpdateContactValues | null,
  companyId: string | undefined,
): UpdateContactValues {
  const base: UpdateContactValues = body ?? {
    firstName: c.firstName,
    lastName: c.lastName,
    phones: c.phones,
    phoneExtensions: { ...(c.phoneExtensions ?? {}) },
    emails: c.emails,
    addresses: c.addresses,
    companyId: c.companyId,
    type: c.type,
    title: c.title,
    notes: c.notes,
  };
  return { ...base, companyId };
}

/* ------------------------------------------------------------------- team */

/** "Assign A Tech": the pick joins the end of the team (once). */
export function withTech(ids: string[], id: string): string[] {
  return ids.includes(id) ? ids : [...ids, id];
}

/** The row's remove action: everyone else stays, in order. */
export function withoutTech(ids: string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}
