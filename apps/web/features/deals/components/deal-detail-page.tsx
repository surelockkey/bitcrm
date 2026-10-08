"use client";

import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { LiveCallStrip } from "@/features/calls/components/live-call-strip";
import { useActiveJobTypes } from "@/features/job-types/active-hooks";
import { useJobType } from "@/features/job-types/hooks";
import { useDealEstimates } from "@/features/estimates/hooks";
import { DealEstimatesTab } from "@/features/estimates/components/deal-estimates-tab";
import { DealInvoiceTab } from "@/features/invoices/components/deal-invoice-tab";
import { DealPaymentsTab } from "@/features/payments/components/deal-payments-tab";
import { useDealPayments } from "@/features/payments/hooks";
import { useInvoiceByDeal } from "@/features/invoices/hooks";
import { usePageHistoryLabel } from "@/components/shell/page-history";
import { useDeal, useMarkSeenOnOpen } from "../hooks";
import { useJobPageData } from "../job-page-data";
import { useAttachments } from "../attachments-hooks";
import { dealTabHref, visibleDealTabs, type DealTab } from "../deal-tabs";
import { dealBalance, dealTabSublabel, jobChatPhone, jobClientName, jobDueDate } from "../job-shell";
import { DealProductsTab } from "./deal-products-tab";
import { DealTimelinePanel } from "./deal-timeline-panel";
import { DealAttachmentsTab } from "./deal-attachments-tab";
import { DetailsTab } from "./deal-details-tab";
import { JobHeader } from "./job-header";
import { JobTabBar } from "./job-tab-bar";

type Tab = DealTab;

/**
 * The job page, framed the way Workiz frames it (job_b_01_details): a grey
 * (#fafcfc) band holding the title, Job name / Status / Tags and the tab
 * bar; the open tab on white under a 1px #cad3d6 rule; and Workiz's right
 * rail down the page's right edge. The Details tab's form lives in
 * deal-details-tab.tsx.
 */
export function DealDetailPage({
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
  const { can, me } = usePermissions();
  const { data: deal, isLoading } = useDeal(dealId);
  const [selectedTab, setSelectedTab] = useState<Tab>(initialTab ?? "details");
  // `?estimate=new` (Create new → Estimate on the client card) is not an
  // estimate: it opens the tab with the New estimate dialog already up.
  const [estimateId, setEstimateId] = useState<string | null>(initialEstimateId === "new" ? null : initialEstimateId);
  const startCreatingEstimate = initialEstimateId === "new";
  const canInvoices = can("invoices");
  const canEstimates = can("estimates");
  const { data: invoice } = useInvoiceByDeal(dealId, canInvoices);
  const canPayments = can("payments");
  // The Payments tab's "$0.00 balance" and the Items tab's Balance box — the
  // same query the tab itself reads, so opening it costs nothing more.
  const { data: jobLedger } = useDealPayments(dealId, canPayments);
  // "1 estimate" under the Estimates tab: the list the tab shows.
  const { data: estimates } = useDealEstimates(dealId, canEstimates);
  const { data: contact } = useContact(deal?.contactId ?? "");
  // "Service" under Details: the job type's name — an archived one is asked
  // for by itself, as the Job type picker does.
  const { data: activeTypes } = useActiveJobTypes();
  const activeType = activeTypes?.find((t) => t.id === deal?.jobTypeId);
  const { data: archivedType } = useJobType(deal?.jobTypeId ?? "", !!deal?.jobTypeId && !!activeTypes && !activeType);
  const tabs = visibleDealTabs({
    estimates: canEstimates,
    invoices: canInvoices,
    payments: canPayments,
  });
  // A deep link to a tab the viewer can't see lands on Details.
  const tab: Tab = tabs.includes(selectedTab) ? selectedTab : "details";

  // Keep the URL shareable without a server round-trip: the App Router picks
  // up native history updates (shallow, no refetch of the page).
  const syncUrl = (nextTab: Tab, nextEstimate: string | null) => {
    if (typeof window === "undefined") return;
    const href = dealTabHref(`${window.location.pathname}${window.location.search}`, nextTab, nextEstimate);
    window.history.replaceState(window.history.state, "", href);
  };
  const setTab = (next: Tab) => {
    setSelectedTab(next);
    syncUrl(next, estimateId);
  };
  const openEstimate = (id: string | null) => {
    setEstimateId(id);
    syncUrl("estimates", id);
  };
  const { data: attachments } = useAttachments(dealId);
  // Everything the page shows, asked for together with the job itself rather
  // than by each block once it has mounted. Without this the page filled in
  // waves and a dispatcher watched the fields arrive.
  const page = useJobPageData(dealId);
  usePageHistoryLabel(deal ? `Job (${deal.dealNumber})` : undefined);
  // Workiz "Viewed job in app": an assigned technician opening the job is what
  // marks it seen — the dispatcher who sent it then sees the eye light up.
  useMarkSeenOnOpen(deal, me?.id);

  // One skeleton, then the page: showing each field the moment its own data
  // lands is what made the job look like it was still loading.
  if (isLoading || !deal || !page.ready)
    return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;

  const canEdit = can("deals", "edit");
  const canDelete = can("deals", "delete");
  const balance = jobLedger?.balanceDue ?? dealBalance(deal);
  const sublabelContext = {
    jobTypeName: activeType?.name ?? archivedType?.name,
    itemsTotal: deal.totals?.total,
    balanceDue: balance,
    estimateCount: estimates?.length ?? 0,
    invoiceStatus: invoice?.status,
    attachmentCount: attachments?.length ?? 0,
  };
  const sublabels = Object.fromEntries(tabs.map((t) => [t, dealTabSublabel(t, sublabelContext)])) as Record<Tab, string>;
  // The yellow pill opens the Invoice tab — where the invoice is made, or
  // shown once it exists.
  const invoicePill =
    canInvoices && (invoice || can("invoices", "create")) ? { exists: Boolean(invoice) } : undefined;
  // "Message Client" texts the job's own number first (J1: MS9277's is on the
  // job, not on the client record).
  const chatPhone = jobChatPhone(deal.phones, contact?.phones);

  return (
    // Clipped, but 36px of grace: Workiz's rail runs from the top bar down,
    // over the breadcrumb strip, and ours rises into it (audit_pixels J1).
    <div className="flex min-h-0 flex-1 overflow-clip [overflow-clip-margin:36px]">
      {/* The page scrolls as one, as Workiz's does: the header, the status
          rows and the tabs ride up with the fields rather than standing over
          a window that scrolls on its own. Only the Save bar stays pinned.
          `relative`: the containing block for absolutely-positioned children
          (Radix's hidden form <select>s) must sit inside the clip chain, or
          they stretch the document past the viewport — see new-deal-page.
          The scroller itself is a plain block: were it the flex column, a page
          taller than the screen would shrink the rows above the fields. The
          column inside grows with its content and fills the screen when there
          is little. */}
      <div data-testid="job-page-scroll" className="relative min-h-0 min-w-0 flex-1 overflow-y-auto bg-white">
        <div className="flex min-h-full flex-col">
          {/* Only while a call is actually happening — that's the one moment
              "link this call" has a subject. */}
          <LiveCallStrip dealId={dealId} />

          {/* Workiz's grey band (#fafcfc, job_b_01 y 91–392). */}
          <div className="bg-[#fafcfc]">
            <JobHeader
              deal={deal}
              clientName={jobClientName(deal, contact)}
              clientHref={contact ? `/contacts/${contact.id}` : undefined}
              canEdit={canEdit}
              canDelete={canDelete}
              canViewWorkOrders={can("work_orders", "view")}
              invoice={invoicePill}
              onOpenInvoice={() => setTab("invoice")}
            />
            <JobTabBar tabs={tabs} active={tab} onSelect={setTab} sublabels={sublabels} />
          </div>

          <div className="flex flex-1 flex-col">
            {/* Details stays mounted (just hidden) so its unsaved draft survives a
                hop to the other tabs. It spans the whole height of its content, so
                the sticky Save bar at its foot stays on screen all the way down. */}
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

      {/* Workiz's right rail: Timeline, notes, calls, the job's messages. */}
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

function TabPanel({ tab, className, children }: { tab: Tab; className?: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" aria-labelledby={`job-tab-${tab}`} className={cn("relative flex-1", className)}>
      {children}
    </div>
  );
}
