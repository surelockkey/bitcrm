"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { WzButtonLink } from "@/components/workiz/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageHistoryLabel } from "@/components/shell/page-history";
import { TECHNICIAN_HOME } from "@/lib/nav/nav-config";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useContact } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { LiveCallStrip } from "@/features/calls/components/live-call-strip";
import { useActiveJobTypes } from "@/features/job-types/active-hooks";
import { useJobType } from "@/features/job-types/hooks";
import { useDealEstimates } from "@/features/estimates/hooks";
import { DealEstimatesTab } from "@/features/estimates/components/deal-estimates-tab";
import { DealInvoiceTab } from "@/features/invoices/components/deal-invoice-tab";
import { useInvoiceByDeal } from "@/features/invoices/hooks";
import { DealPaymentsTab } from "@/features/payments/components/deal-payments-tab";
import { useDealPayments } from "@/features/payments/hooks";
import { useAttachments } from "@/features/deals/attachments-hooks";
import { dealTabHref, visibleDealTabs, type DealTab } from "@/features/deals/deal-tabs";
import { useDeal, useMarkSeenOnOpen } from "@/features/deals/hooks";
import { useJobPageData } from "@/features/deals/job-page-data";
import { dealBalance, dealTabSublabel, jobChatPhone, jobClientName, jobDueDate } from "@/features/deals/job-shell";
import { DealAttachmentsTab } from "@/features/deals/components/deal-attachments-tab";
import { DetailsTab } from "@/features/deals/components/deal-details-tab";
import { DealProductsTab } from "@/features/deals/components/deal-products-tab";
import { DealTimelinePanel } from "@/features/deals/components/deal-timeline-panel";
import { JobHeader } from "@/features/deals/components/job-header";
import { JobTabBar } from "@/features/deals/components/job-tab-bar";
import { TechActions } from "./tech-actions";

/**
 * `/my-jobs/:id` — the job as a Workiz technician opens it: Workiz's job page
 * (job_b_01_details), which is also its app's job. The grey (#fafcfc) band
 * with "Job #5TU7ZA - Dustin Roselle", Actions ⌄ and the yellow invoice
 * pill, the Job name / Status / Tags rows and the job tab bar; the open tab
 * on white; the right rail (Timeline, notes, calls, the job's messages).
 * Composed from the job page's own blocks (`features/deals`), with the same
 * one-load gate (`useJobPageData`) and the same permission checks, so what a
 * technician may change there they may change here.
 *
 * Ours on top of Workiz's: the visit — Confirm receipt, On my way, Running
 * late, Arrived, Start job, Job Done and their stamps — as one more row of
 * the band under Tags (`TechActions`). Where the old phone page had its own
 * blocks, Workiz has a place: Navigate is the address box's road sign, Call
 * the phone box's icon, photos the Attachments tab's Upload, a note the
 * rail's Notes.
 *
 * Mirrors `DealDetailPage`; a change to the job page's frame (a tab, the
 * invoice's own page) belongs here too.
 */
export function TechJobPage({
  dealId,
  initialTab = null,
  initialEstimateId = null,
}: {
  dealId: string;
  /** From `?tab=` — the tab to open first. */
  initialTab?: DealTab | null;
  /** From `?estimate=` — the estimate to open on the Estimates tab. */
  initialEstimateId?: string | null;
}) {
  const denied = useDenied();
  const { can, me } = usePermissions();
  const { data: deal, isLoading, isError } = useDeal(dealId);
  const [selectedTab, setSelectedTab] = useState<DealTab>(initialTab ?? "details");
  const [estimateId, setEstimateId] = useState<string | null>(initialEstimateId === "new" ? null : initialEstimateId);
  const startCreatingEstimate = initialEstimateId === "new";
  const canInvoices = can("invoices");
  const canEstimates = can("estimates");
  const canPayments = can("payments");
  const { data: invoice } = useInvoiceByDeal(dealId, canInvoices);
  const { data: jobLedger } = useDealPayments(dealId, canPayments);
  const { data: estimates } = useDealEstimates(dealId, canEstimates);
  const { data: contact } = useContact(deal?.contactId ?? "");
  const { data: activeTypes } = useActiveJobTypes();
  const activeType = activeTypes?.find((t) => t.id === deal?.jobTypeId);
  const { data: archivedType } = useJobType(deal?.jobTypeId ?? "", !!deal?.jobTypeId && !!activeTypes && !activeType);
  const { data: attachments } = useAttachments(dealId);
  const tabs = visibleDealTabs({ estimates: canEstimates, invoices: canInvoices, payments: canPayments });
  const tab: DealTab = tabs.includes(selectedTab) ? selectedTab : "details";

  // The URL stays shareable without a round-trip (shallow, as the job page does).
  const syncUrl = (nextTab: DealTab, nextEstimate: string | null) => {
    if (typeof window === "undefined") return;
    const href = dealTabHref(`${window.location.pathname}${window.location.search}`, nextTab, nextEstimate);
    window.history.replaceState(window.history.state, "", href);
  };
  const setTab = (next: DealTab) => {
    setSelectedTab(next);
    syncUrl(next, estimateId);
  };
  const openEstimate = (id: string | null) => {
    setEstimateId(id);
    syncUrl("estimates", id);
  };

  // One wait for the job and everything it shows (the visit row needs only
  // the job), then the page whole.
  const page = useJobPageData(dealId);
  usePageHistoryLabel(deal ? `Job (${deal.dealNumber})` : undefined);
  // Workiz "Viewed job in app": the assigned technician opening it marks it seen.
  useMarkSeenOnOpen(deal, me?.id);

  if (denied("deals", "view")) return <NoAccess entity="jobs" />;

  if (!deal && isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">Job not found</h2>
        <p className="text-sm text-wz-outline-label">It may have been reassigned. Your list has the jobs you are on.</p>
        <WzButtonLink href={TECHNICIAN_HOME} variant="secondary" size="regular" className="mt-2">
          Back to my jobs
        </WzButtonLink>
      </div>
    );
  }

  if (isLoading || !deal || !page.ready) return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;

  const canEdit = can("deals", "edit");
  const balance = jobLedger?.balanceDue ?? dealBalance(deal);
  const sublabelContext = {
    jobTypeName: activeType?.name ?? archivedType?.name,
    itemsTotal: deal.totals?.total,
    balanceDue: balance,
    estimateCount: estimates?.length ?? 0,
    invoiceStatus: invoice?.status,
    attachmentCount: attachments?.length ?? 0,
  };
  const sublabels = Object.fromEntries(tabs.map((t) => [t, dealTabSublabel(t, sublabelContext)])) as Record<DealTab, string>;
  const invoicePill = canInvoices && (invoice || can("invoices", "create")) ? { exists: Boolean(invoice) } : undefined;
  const chatPhone = jobChatPhone(deal.phones, contact?.phones);

  return (
    // The job page's frame (deal-detail-page.tsx): clipped with 36px of grace
    // for the rail, which rises into the breadcrumb strip as Workiz's does.
    <div className="flex min-h-0 flex-1 overflow-clip [overflow-clip-margin:36px]">
      <div data-testid="job-page-scroll" className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-white">
        <div className="flex min-h-full flex-col">
          <LiveCallStrip dealId={dealId} />

          {/* Workiz's grey band (#fafcfc, job_b_01 y 91–392), the visit one more row of it. */}
          <div className="bg-[#fafcfc]">
            <JobHeader
              deal={deal}
              clientName={jobClientName(deal, contact)}
              clientHref={contact ? `/contacts/${contact.id}` : undefined}
              canEdit={canEdit}
              canDelete={can("deals", "delete")}
              canViewWorkOrders={can("work_orders", "view")}
              invoice={invoicePill}
              onOpenInvoice={() => setTab("invoice")}
            />
            <div className="px-4 md:px-10">
              <TechActions deal={deal} />
            </div>
            <JobTabBar tabs={tabs} active={tab} onSelect={setTab} sublabels={sublabels} />
          </div>

          <div className="flex flex-1 flex-col">
            <div role="tabpanel" aria-labelledby="job-tab-details" className={cn("flex flex-1 flex-col", tab !== "details" && "hidden")}>
              <DetailsTab deal={deal} canEdit={canEdit} />
            </div>
            {tab === "items" ? (
              <TabPanel tab="items" className="px-4 pt-10 pb-12 md:px-10">
                <DealProductsTab
                  deal={deal}
                  canEdit={canEdit}
                  variant="job"
                  showCost={can("financials", "view")}
                  balance={balance}
                  due={jobDueDate(deal, invoice?.dueDate) || undefined}
                />
              </TabPanel>
            ) : null}
            {tab === "payments" ? (
              <TabPanel tab="payments" className="px-2 pt-10 pb-12 md:px-5">
                <DealPaymentsTab deal={deal} />
              </TabPanel>
            ) : null}
            {tab === "estimates" ? (
              <TabPanel tab="estimates" className="px-4 pt-10 pb-12 md:px-10">
                <DealEstimatesTab deal={deal} estimateId={estimateId} onEstimateChange={openEstimate} startCreating={startCreatingEstimate} />
              </TabPanel>
            ) : null}
            {tab === "invoice" ? (
              <TabPanel tab="invoice" className="px-4 pt-10 pb-12 md:px-10">
                <DealInvoiceTab deal={deal} canEditItems={canEdit} />
              </TabPanel>
            ) : null}
            {tab === "attachments" ? (
              <TabPanel tab="attachments" className="px-4 pt-5 pb-12 md:px-5">
                <DealAttachmentsTab dealId={dealId} canEdit={canEdit} />
              </TabPanel>
            ) : null}
          </div>
        </div>
      </div>

      <DealTimelinePanel
        dealId={dealId}
        canEdit={canEdit}
        canViewMessages={can("messages", "view")}
        client={{ name: jobClientName(deal, contact), phones: [...(deal.phones ?? []), ...(contact?.phones ?? [])] }}
        chat={
          contact && can("messages", "send")
            ? { contactId: contact.id, name: contactName(contact), phone: chatPhone.phone, phoneOnContact: chatPhone.onContact }
            : undefined
        }
        schedule={{ date: deal.scheduledDate, slot: deal.scheduledTimeSlot, allDay: deal.allDay }}
      />
    </div>
  );
}

function TabPanel({ tab, className, children }: { tab: DealTab; className?: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" aria-labelledby={`job-tab-${tab}`} className={cn("relative flex-1", className)}>
      {children}
    </div>
  );
}
