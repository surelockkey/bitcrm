"use client";

import { useMemo } from "react";
import { useQueries, type UseQueryResult } from "@tanstack/react-query";
import type { Contact, Deal } from "@bitcrm/types";
import { queryKeys } from "@/lib/query-keys";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { getContactsByIds } from "@/features/clients/api";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useTeamChatCounters } from "@/features/messaging/hooks";
import { useMyJobs } from "./hooks";

/** The most clients crm names in one ask. */
const CONTACTS_PER_ASK = 100;

interface DayContacts {
  map: Map<string, Contact>;
  /** Every ask has answered — or failed, which leaves those cards unnamed rather than waiting. */
  settled: boolean;
}

// Module-level, so React Query keeps the combined answer while nothing in it changed.
const combineContacts = (results: UseQueryResult<Contact[]>[]): DayContacts => ({
  map: new Map(results.flatMap((r) => r.data ?? []).map((c) => [c.id, c] as const)),
  settled: results.every(settled),
});

/**
 * The clients of every job on the list, named in as few asks as crm allows —
 * one for a day of any ordinary size. Each card used to ask for its own,
 * after it had been drawn. Numbers are masked by crm exactly as for a single
 * client, so a card reads the same either way.
 */
export function useDayContacts(deals: Deal[]): DayContacts {
  const chunks = useMemo(() => {
    const ids = [...new Set(deals.map((d) => d.contactId))].filter(Boolean).sort();
    const out: string[][] = [];
    for (let i = 0; i < ids.length; i += CONTACTS_PER_ASK) out.push(ids.slice(i, i + CONTACTS_PER_ASK));
    return out;
  }, [deals]);
  return useQueries({
    queries: chunks.map((ids) => ({
      queryKey: queryKeys.contacts.byIds(ids),
      queryFn: () => getContactsByIds(ids),
      staleTime: 60_000,
    })),
    combine: combineContacts,
  });
}

/**
 * Everything `/my-jobs` shows, asked for at once and shown in one frame: the
 * day's jobs, their clients (name, number, the Call button), the job types
 * and statuses the cards print, and the unread count on the chat badge.
 *
 * `ready` holds the page behind its skeleton until all of it is in — a
 * failure counts — and then stays: a pull to refresh refetches under a list
 * that is already there.
 */
export function useMyJobsPage() {
  const { isLoading: permsLoading } = usePermissions();
  const jobs = useMyJobs();
  const contacts = useDayContacts(jobs.data);
  const jobTypes = useJobTypes();
  const jobStatuses = useJobStatuses();
  const counters = useTeamChatCounters();

  const allIn =
    !permsLoading &&
    jobs.ready &&
    !jobs.isLoading &&
    contacts.settled &&
    settled(jobTypes) &&
    settled(jobStatuses) &&
    settled(counters);

  return { jobs, contacts: contacts.map, ready: usePageReady(allIn) };
}
