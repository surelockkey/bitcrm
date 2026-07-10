import type { Contact, Company, ClientType, PaginatedResponse } from "@bitcrm/types";
import { http, apiFetchPaginated } from "@/lib/api/http";
import type {
  CreateContactValues,
  UpdateContactValues,
  CreateCompanyValues,
  UpdateCompanyValues,
} from "./schemas";

const PAGE = 100;

/* ---------------------------------------------------------------- contacts */

export function listContacts(
  companyId?: string,
  cursor?: string,
): Promise<PaginatedResponse<Contact>> {
  const q = new URLSearchParams({ limit: String(PAGE) });
  if (companyId) q.set("companyId", companyId);
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Contact>(`/crm/contacts?${q}`);
}

/**
 * Walk every page. The list endpoint has no text search, so we load all
 * contacts and filter client-side. A scan page can be empty while a cursor
 * still exists, so loop until `nextCursor` is gone — never trust `count`.
 */
export async function fetchAllContacts(companyId?: string): Promise<Contact[]> {
  const out: Contact[] = [];
  let cursor: string | undefined;
  do {
    const page = await listContacts(companyId, cursor);
    out.push(...page.data);
    cursor = page.pagination.nextCursor;
  } while (cursor);
  return out;
}

export const getContact = (id: string): Promise<Contact> =>
  http.get<Contact>(`/crm/contacts/${id}`);

export const searchContactByPhone = (phone: string): Promise<Contact | null> =>
  http.get<Contact | null>(`/crm/contacts/search/by-phone?phone=${encodeURIComponent(phone)}`);

export const createContact = (body: CreateContactValues): Promise<Contact> =>
  http.post<Contact>("/crm/contacts", body);

export const updateContact = (id: string, body: UpdateContactValues): Promise<Contact> =>
  http.put<Contact>(`/crm/contacts/${id}`, body);

export const deleteContact = (id: string): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`/crm/contacts/${id}`);

/* --------------------------------------------------------------- companies */

export function listCompanies(
  clientType?: ClientType,
  cursor?: string,
): Promise<PaginatedResponse<Company>> {
  const q = new URLSearchParams({ limit: String(PAGE) });
  if (clientType) q.set("clientType", clientType);
  if (cursor) q.set("cursor", cursor);
  return apiFetchPaginated<Company>(`/crm/companies?${q}`);
}

export async function fetchAllCompanies(clientType?: ClientType): Promise<Company[]> {
  const out: Company[] = [];
  let cursor: string | undefined;
  do {
    const page = await listCompanies(clientType, cursor);
    out.push(...page.data);
    cursor = page.pagination.nextCursor;
  } while (cursor);
  return out;
}

export const getCompany = (id: string): Promise<Company> =>
  http.get<Company>(`/crm/companies/${id}`);

export const getCompanyContacts = (id: string): Promise<Contact[]> =>
  apiFetchPaginated<Contact>(`/crm/companies/${id}/contacts?limit=${PAGE}`).then((r) => r.data);

export const createCompany = (body: CreateCompanyValues): Promise<Company> =>
  http.post<Company>("/crm/companies", body);

export const updateCompany = (id: string, body: UpdateCompanyValues): Promise<Company> =>
  http.put<Company>(`/crm/companies/${id}`, body);

export const deleteCompany = (id: string): Promise<{ id: string; deleted: true }> =>
  http.delete<{ id: string; deleted: true }>(`/crm/companies/${id}`);
