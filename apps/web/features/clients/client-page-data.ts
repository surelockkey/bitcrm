"use client";

import { useEffect } from "react";
import { settled, usePageReady, type QueryState } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useClientTags } from "@/features/client-tags/hooks";
import { useDealsPage } from "@/features/deals/hooks";
import { useEstimatesForContacts } from "@/features/estimates/hooks";
import { useInvoicesForContacts } from "@/features/invoices/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { usePaymentList } from "@/features/payments/hooks";
import { usePortalLink } from "@/features/portal/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { useCompany, useContact } from "./hooks";
import { useContactNotes } from "./notes-hooks";

const JOBS_PAGE = 50;
const PAYMENTS_PAGE = 100;

/**
 * How many pages of a client's jobs (and payments) the card waits for before
 * it goes up. Nearly every client fits in the first; a big commercial account
 * can run to hundreds of jobs, and the card does not wait for all of them —
 * the rest are counted after it is up, with the numbers saying "at least".
 */
export const FIRST_PAINT_PAGES = 4;

/** The client's jobs, every page — the Jobs tab, its badge and the Addresses tab read them. */
export function useClientJobs(contactId: string) {
  return useDealsPage({ contactId, limit: JOBS_PAGE }, !!contactId);
}

/** The client's payments, every page, so the tab's badge is a number. */
export function useClientPayments(contactId: string, enabled: boolean) {
  return usePaymentList({ contactId, limit: PAYMENTS_PAGE }, !!contactId && enabled);
}

/**
 * A tab's number while the rest of a big client's pages are still being
 * counted: what the first pages held, "at least". It holds still until the
 * count is final, then changes once — it does not tick up page by page,
 * pushing the tabs beside it across each time.
 */
export function countSoFar<T>(pages: T[][], more: boolean, count: (rows: T[]) => number = (rows) => rows.length): string {
  if (!more) return String(count(pages.flat()));
  return `${count(pages.slice(0, FIRST_PAINT_PAGES).flat())}+`;
}

interface PagedState extends QueryState {
  data: { pages: unknown[] } | undefined;
  hasNextPage: boolean;
}

/** In once it failed, was never asked, or holds every page — or the first few of a big client's. */
function pagesIn(q: PagedState): boolean {
  if (q.isError) return true;
  if (q.data === undefined) return q.isPending && q.fetchStatus === "idle";
  return !q.hasNextPage || q.data.pages.length >= FIRST_PAINT_PAGES;
}

/**
 * Everything the client card shows, asked for at once — so the card appears
 * once, whole, instead of filling in while the office watches.
 *
 * Each block of the card reads its own data, and used to ask for it only once
 * it had mounted: the client first, then the permissions' cards and tabs, the
 * cards' numbers, the tag chips, the Ad source's name, the jobs table's job
 * types, the portal card, the Notes badge — wave after wave. This asks for all
 * of it the moment the card opens (the jobs and the documents go out with the
 * client, not after it), calling the very hooks the blocks call, so the
 * blocks find their answers in the cache and ask for nothing more.
 *
 * It also walks the client's jobs and payments to the last page, so the tabs'
 * numbers are exact; the card waits for the first `FIRST_PAINT_PAGES` of them.
 *
 * `ready` holds the card behind one skeleton until every answer is in — a
 * failed one counts — and once up it stays up: a refetch after a save must
 * not take the card, and an open popup's draft, away. Another client starts
 * over behind the skeleton.
 *
 * The other tabs (Estimates, Invoices, Calls) and the rail's panels still load
 * when opened: they are not on the screen the card opens to.
 */
export function useClientPageData(contactId: string): { ready: boolean } {
  const { can, isLoading: permsLoading } = usePermissions();
  const contact = useContact(contactId);
  const company = useCompany(contact.data?.companyId ?? "");
  const jobs = useClientJobs(contactId);
  const payments = useClientPayments(contactId, can("payments"));
  const invoices = useInvoicesForContacts([contactId], can("invoices"));
  const estimates = useEstimatesForContacts([contactId], can("estimates"));
  // What the blocks print beside the client: tag names, the jobs' types, the
  // portal link, the Notes badge.
  const tags = useClientTags();
  const jobTypes = useJobTypes();
  const portal = usePortalLink(contactId, can("invoices") || can("estimates"));
  const notes = useContactNotes(contactId);
  // The zones the Jobs tab turns its visits to the account's clock with.
  const areas = useServiceAreas();
  // The sub-status names of the Jobs tab's Status column.
  const statuses = useJobStatuses();

  // Every page, one after another: the Jobs tab pages them with an exact
  // "Page 1 of 76", the Addresses tab counts jobs per address, and the badges
  // are numbers, not "50+".
  const { hasNextPage: moreJobs, isFetchingNextPage: fetchingJobs, fetchNextPage: fetchJobs } = jobs;
  useEffect(() => {
    if (moreJobs && !fetchingJobs) void fetchJobs();
  }, [moreJobs, fetchingJobs, fetchJobs]);
  const { hasNextPage: morePayments, isFetchingNextPage: fetchingPayments, fetchNextPage: fetchPayments } = payments;
  useEffect(() => {
    if (morePayments && !fetchingPayments) void fetchPayments();
  }, [morePayments, fetchingPayments, fetchPayments]);

  const allIn =
    !permsLoading &&
    [contact, company, tags, jobTypes, portal, notes, areas, statuses].every(settled) &&
    pagesIn(jobs) &&
    pagesIn(payments) &&
    !invoices.isLoading &&
    !estimates.isLoading;

  return { ready: usePageReady(allIn, contactId) };
}
