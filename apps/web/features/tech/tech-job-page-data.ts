"use client";

import { settled, usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact } from "@/features/clients/hooks";
import { useAttachments } from "@/features/deals/attachments-hooks";
import { useDeal } from "@/features/deals/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTypes } from "@/features/job-types/hooks";

/**
 * Everything `/my-jobs/:id` shows, asked for at once — so the job appears
 * once, whole: the job, its client (name, number, the Call button), the job
 * type and status names, and the photos already on it. The client goes out
 * the moment the job lands; the rest goes out with the job.
 *
 * It calls the very hooks the page's blocks call, so they read from the
 * cache. `ready` holds the page behind its skeleton until all of it is in — a
 * failure counts, so a job that cannot be read says so rather than waiting —
 * and then stays for this job: a refetch after "Arrived" never takes the page
 * away. Another job starts behind the skeleton again.
 */
export function useTechJobPageData(dealId: string): { ready: boolean } {
  const { isLoading: permsLoading } = usePermissions();
  const deal = useDeal(dealId);
  const contact = useContact(deal.data?.contactId ?? "");
  const attachments = useAttachments(dealId);
  const jobTypes = useJobTypes();
  const jobStatuses = useJobStatuses();

  const allIn = !permsLoading && [deal, contact, attachments, jobTypes, jobStatuses].every(settled);
  return { ready: usePageReady(allIn, dealId) };
}
