"use client";

import type { CustomFieldValue, Deal } from "@bitcrm/types";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact } from "@/features/clients/hooks";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { applicableFields } from "@/features/custom-fields/lib";
import { useInvoiceByDeal } from "@/features/invoices/hooks";
import { useMessagesByJob, useMessagingSettings } from "@/features/messaging/hooks";
import { useDealPayments } from "@/features/payments/hooks";
import { useEffectiveServiceArea, useServiceAreas } from "@/features/service-areas/hooks";
import { useJobCode, useTelephonyConfig } from "@/features/telephony/config-hooks";
import { useAttachments, useAttachmentUrls } from "./attachments-hooks";
import { useDealEstimates } from "@/features/estimates/hooks";
import { useActiveJobTypes } from "@/features/job-types/active-hooks";
import { useJobType } from "@/features/job-types/hooks";
import { useDeal, useDealAssignments, useDealTimeline, useSuggestedTechs, useUserMap } from "./hooks";
import { useJobPageCatalogs } from "./job-page-catalogs";

const NO_IDS: string[] = [];

/** The files the job's file-type custom fields hold — their thumbnails need a URL each. */
function customFieldFileIds(deal: Deal | undefined, defs: ReturnType<typeof useCustomFields>["data"]): string[] {
  if (!deal?.customFields) return NO_IDS;
  const ids: string[] = [];
  for (const field of applicableFields(defs, deal.jobTypeId)) {
    if (field.type !== "file") continue;
    const answer: CustomFieldValue | undefined = deal.customFields[field.id];
    if (Array.isArray(answer)) ids.push(...answer.map(String));
    else if (typeof answer === "string" && answer) ids.push(answer);
  }
  return ids.length ? ids : NO_IDS;
}

/**
 * Everything the job page shows, asked for at once — so the page appears once,
 * whole, instead of filling in while the dispatcher watches.
 *
 * Each block on the page reads its own data, and used to ask for it only once
 * it had mounted: the job first, then the client, the service area, the
 * team's names, "N can do this job", the dial-in card — wave after wave. This
 * asks for all of it the moment the page opens: what needs no job goes out
 * with the job itself, what needs the job's fields goes out the moment the job
 * lands. It calls the very hooks the blocks call, so the blocks find their
 * answers in the cache and ask for nothing more.
 *
 * `ready` holds the page behind one skeleton until every answer is in — a
 * failed one counts, so one broken request never keeps the job off screen —
 * and once the page is up it stays up: a refetch after a save is not a
 * reason to take the job away from someone mid-edit.
 *
 * The other tabs and the timeline still load when opened: they are not on the
 * screen the job opens to.
 */
export function useJobPageData(dealId: string): { ready: boolean } {
  const { can, isLoading: permsLoading } = usePermissions();
  const { data: deal } = useDeal(dealId);
  const catalogs = useJobPageCatalogs();
  const { data: customFieldDefs } = useCustomFields();

  // Needs nothing but the job's id — out together with the job.
  const attachments = useAttachments(dealId);
  const invoice = useInvoiceByDeal(dealId, can("invoices"));
  const ledger = useDealPayments(dealId, can("payments"));
  const jobCode = useJobCode(dealId);
  const telephony = useTelephonyConfig();
  const messaging = useMessagingSettings(can("settings"));
  const areas = useServiceAreas();
  // The frame around the form: the right rail's notes badge reads the
  // timeline's first page, the tab bar's "N estimates" the estimates list.
  const timeline = useDealTimeline(dealId);
  // The Timeline's "Messages (n)" (and its "All"): the job's texts.
  const messages = useMessagesByJob(dealId, can("messages", "view"));
  const estimates = useDealEstimates(dealId, can("estimates"));
  const activeTypes = useActiveJobTypes();

  // Needs the job's own fields — out the moment the job lands.
  const lat = deal?.address?.lat;
  const lng = deal?.address?.lng;
  const techIds = deal?.assignedTechIds ?? NO_IDS;
  const contact = useContact(deal?.contactId ?? "");
  const area = useEffectiveServiceArea(lat, lng, undefined);
  const users = useUserMap(techIds);
  const assignments = useDealAssignments(dealId, techIds.length > 0);
  // Only an editor sees the suggestions (and only an editor may ask for them).
  const suggestions = useSuggestedTechs(
    { jobTypeId: deal?.jobTypeId || undefined, lat, lng },
    !!deal && can("deals", "edit") && lat !== undefined && lng !== undefined,
  );
  const files = useAttachmentUrls(dealId, customFieldFileIds(deal, customFieldDefs));
  // "Service" under the Details tab names the job type; an archived one is
  // not in the active list and is asked for by itself (as the picker does).
  const archivedType = useJobType(
    deal?.jobTypeId ?? "",
    !!deal?.jobTypeId && !!activeTypes.data && !activeTypes.data.some((t) => t.id === deal.jobTypeId),
  );

  const allIn =
    !!deal &&
    !permsLoading &&
    catalogs.ready &&
    [
      attachments,
      invoice,
      ledger,
      jobCode,
      telephony,
      messaging,
      areas,
      contact,
      assignments,
      suggestions,
      timeline,
      messages,
      estimates,
      archivedType,
      ...files,
    ].every(settled) &&
    !area.isFetching &&
    !users.isLoading;

  // Once shown, the page stays shown (the page is keyed by job, so the next
  // job starts behind the skeleton again).
  return { ready: usePageReady(allIn) };
}
