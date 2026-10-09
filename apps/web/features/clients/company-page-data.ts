"use client";

import { useMemo } from "react";
import type { Contact } from "@bitcrm/types";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useEstimatesForContacts } from "@/features/estimates/hooks";
import { useInvoicesForContacts } from "@/features/invoices/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useCompany, useCompanyContacts } from "./hooks";

const NO_PEOPLE: Contact[] = [];

/**
 * Everything the company page shows, asked for with the page — the company,
 * its people (the Contacts tab and their ad sources' names), and every
 * person's invoices and estimates (the totals over the tabs and the tabs'
 * numbers) — so the page appears once, whole.
 *
 * The documents can only be asked for once the people are known; the page
 * waits for them too. `ready` stays up once up (an open form's draft must
 * not vanish behind a refetch), and another company starts over.
 *
 * The page calls the same hooks with the same ids, and finds every answer
 * in the cache.
 */
export function useCompanyPageData(companyId: string) {
  const { can, isLoading: permsLoading } = usePermissions();
  const company = useCompany(companyId);
  const contacts = useCompanyContacts(companyId);
  const jobSources = useJobSources();
  const people = contacts.data ?? NO_PEOPLE;
  const ids = useMemo(() => people.map((c) => c.id), [people]);
  const invoices = useInvoicesForContacts(ids, can("invoices"));
  const estimates = useEstimatesForContacts(ids, can("estimates"));

  const allIn =
    !permsLoading && settled(company) && settled(contacts) && settled(jobSources) && !invoices.isLoading && !estimates.isLoading;
  const ready = usePageReady(allIn, companyId);

  return { ready, company: company.data, people, invoices: invoices.data, estimates: estimates.data };
}
