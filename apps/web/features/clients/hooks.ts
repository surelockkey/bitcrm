"use client";

import { useMemo } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ClientType, Company, Contact, CompanyDocumentType } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { useGlobalSearch } from "@/features/search/use-global-search";
import { getApiErrorMessage } from "@/lib/api/errors";
import * as api from "./api";
import type {
  CreateContactValues,
  UpdateContactValues,
  CreateCompanyValues,
  UpdateCompanyValues,
} from "./schemas";
import { contactName } from "./lib";

/* ---------------------------------------------------------------- contacts */

/** All contacts (optionally scoped to a company) — loaded for client-side search. */

/**
 * The contacts list a page at a time — the CRM pages it by cursor, and the
 * Contacts page asks for the next page on request. Never the whole table.
 */
export function useContactsPage(companyId?: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: queryKeys.contacts.page(companyId),
    queryFn: ({ pageParam }) => api.listContacts(companyId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.pagination.nextCursor,
    enabled,
  });
}

/**
 * Contacts matching typed text — a name, a phone, an email — answered by
 * the search service and hydrated in one call, masked like any contact
 * route. Idle (empty data, not loading) below two characters.
 */
export function useContactSearch(query: string, limit = 50) {
  const found = useGlobalSearch(query, { types: ["contact"], mode: "full", limit });
  const ids = (found.data?.hits ?? []).map((h) => h.entityId);
  const hydrated = useContactsByIds(ids);
  const data = useMemo(() => ids.map((id) => hydrated.map.get(id)).filter((c): c is Contact => Boolean(c)), [ids, hydrated.map]);
  return {
    data,
    isLoading: found.isSearching || (ids.length > 0 && hydrated.isLoading),
    /** True while the text is too short to search. */
    tooShort: found.tooShort,
  };
}

/**
 * The contacts behind the rows on screen — a jobs page, a calls page — as a
 * map by id. Sorted and de-duplicated so the key is stable; nothing is asked
 * for an empty list.
 */
export function useContactsByIds(ids: string[]) {
  const wanted = useMemo(() => [...new Set(ids)].filter(Boolean).sort(), [ids]);
  const q = useQuery({
    queryKey: queryKeys.contacts.byIds(wanted),
    queryFn: () => api.getContactsByIds(wanted),
    enabled: wanted.length > 0,
    staleTime: 60_000,
  });
  const map = useMemo(() => {
    const m = new Map<string, Contact>();
    for (const c of q.data ?? []) m.set(c.id, c);
    return m;
  }, [q.data]);
  return { map, isLoading: q.isLoading };
}

export function useContact(id: string) {
  return useQuery({
    queryKey: queryKeys.contacts.detail(id),
    queryFn: () => api.getContact(id),
    // Callers pass "" when there is no contact in hand yet.
    enabled: !!id,
  });
}

/** Phone-dedup lookup for the create form. Returns the match or null. */
export function useContactByPhone(phone: string, enabled: boolean) {
  return useQuery<Contact | null>({
    queryKey: queryKeys.contacts.byPhone(phone),
    queryFn: () => api.searchContactByPhone(phone),
    enabled: enabled && phone.length >= 7,
    staleTime: 30_000,
  });
}

function useInvalidateClients() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.contacts.all() });
    qc.invalidateQueries({ queryKey: queryKeys.companies.all() });
  };
}

export function useCreateContact() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (body: CreateContactValues & { reassignPhones?: boolean }) =>
      api.createContact(body),
    onSuccess: (c) => {
      invalidate();
      toast.success(`Contact “${contactName(c)}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateContact() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateContactValues }) =>
      api.updateContact(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Contact saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useMergeContacts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: api.MergeContactsBody) => api.mergeContacts(body),
    onSuccess: (c) => {
      qc.invalidateQueries({ queryKey: queryKeys.contacts.all() });
      qc.invalidateQueries({ queryKey: queryKeys.companies.all() });
      // The duplicates' deals are re-pointed to the survivor server-side
      // (contact.merged event), so cached deal lists go stale too.
      qc.invalidateQueries({ queryKey: queryKeys.deals.all() });
      toast.success(`Contacts merged into “${contactName(c)}”`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteContact() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (id: string) => api.deleteContact(id),
    onSuccess: () => {
      invalidate();
      toast.success("Contact deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/* --------------------------------------------------------------- companies */

export function useCompanies(clientType?: ClientType) {
  return useQuery({
    queryKey: queryKeys.companies.list({ clientType }),
    queryFn: () => api.fetchAllCompanies(clientType),
  });
}

export function useCompany(id: string) {
  return useQuery({
    queryKey: queryKeys.companies.detail(id),
    queryFn: () => api.getCompany(id),
  });
}

export function useCompanyContacts(id: string) {
  return useQuery({
    queryKey: queryKeys.companies.contacts(id),
    queryFn: () => api.getCompanyContacts(id),
  });
}

/** id → Company, for resolving a contact's company name/type across the UI. */
export function useCompanyMap() {
  const companies = useCompanies();
  const map = useMemo(() => {
    const m = new Map<string, Company>();
    for (const c of companies.data ?? []) m.set(c.id, c);
    return m;
  }, [companies.data]);
  return { map, companies: companies.data ?? [], isLoading: companies.isLoading };
}

export function useCreateCompany() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (body: CreateCompanyValues) => api.createCompany(body),
    onSuccess: (c: Company) => {
      invalidate();
      toast.success(`Company “${c.title}” created`);
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useUpdateCompany() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateCompanyValues }) =>
      api.updateCompany(id, body),
    onSuccess: () => {
      invalidate();
      toast.success("Company saved");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteCompany() {
  const invalidate = useInvalidateClients();
  return useMutation({
    mutationFn: (id: string) => api.deleteCompany(id),
    onSuccess: () => {
      invalidate();
      toast.success("Company deleted");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

/* -------------------------------------------- company compliance documents */

export function useCompanyDocuments(id: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.companies.documents(id),
    queryFn: () => api.listCompanyDocuments(id),
    enabled: enabled && Boolean(id),
  });
}

export function useUploadCompanyDocument(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ docType, file }: { docType: CompanyDocumentType; file: File }) => {
      const { uploadUrl, headers } = await api.getCompanyDocumentUploadUrl(companyId, docType, file.type);
      await api.uploadCompanyDocumentBytes(uploadUrl, file, headers);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.companies.documents(companyId) });
      toast.success("Document uploaded");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export function useDeleteCompanyDocument(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (docType: CompanyDocumentType) => api.deleteCompanyDocument(companyId, docType),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.companies.documents(companyId) });
      toast.success("Document removed");
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });
}

export type { Contact, Company };
