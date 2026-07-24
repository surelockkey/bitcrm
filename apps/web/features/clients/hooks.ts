"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ClientType, Company, Contact, CompanyDocumentType } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
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
export function useContacts(companyId?: string) {
  return useQuery({
    queryKey: queryKeys.contacts.list({ companyId }),
    queryFn: () => api.fetchAllContacts(companyId),
  });
}

export function useContact(id: string) {
  return useQuery({
    queryKey: queryKeys.contacts.detail(id),
    queryFn: () => api.getContact(id),
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
    mutationFn: (body: CreateContactValues) => api.createContact(body),
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
