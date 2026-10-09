"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CreditCard, FileSpreadsheet, FileText, Home, MessageSquareText, Wrench } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { WzTabBar, type WzTab } from "@/components/workiz/tab-bar";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCreateClientEstimate, useEstimatesForContacts } from "@/features/estimates/hooks";
import { useCreateClientInvoice, useInvoicesForContacts } from "@/features/invoices/hooks";
import { accountToday } from "@/features/reports/report-dates";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { amountDueByDeal, byJobDateDesc, clientAddressRows, clientKpis, pastDueByDeal } from "../client-page";
import { countSoFar, useClientJobs, useClientPageData, useClientPayments } from "../client-page-data";
import { useCompany, useContact, useDeleteContact } from "../hooks";
import { contactName } from "../lib";
import { ClientAddressesTab } from "./client-addresses-tab";
import { ClientAddressSheet, type AddressSheetMode } from "./client-address-sheet";
import { ClientEstimatesTab, ClientInvoicesTab, ClientPaymentsTab } from "./client-billing-tabs";
import { ClientCallsTab } from "./client-calls-tab";
import { EditClientDialog } from "./edit-client-dialog";
import { PayInvoicesDialog } from "./pay-invoices-dialog";
import { ServiceLocationDialog } from "./service-location-dialog";
import { ClientChatSheet } from "./client-chat-sheet";
import { ClientJobsTab } from "./client-jobs-tab";
import { ClientKpiStrip } from "./client-kpi-strip";
import { ClientRail } from "./client-rail";
import { ClientSummaryPanel } from "./client-summary-panel";
import { DeleteClientDialog } from "./delete-client-dialog";

type TabId = "jobs" | "estimates" | "invoices" | "payments" | "addresses" | "calls";

/** Workiz's Create new rows (`MenuPopup`): 35px, 8px 12px, 13px/19px ink, an 18px glyph. */
const MENU_ROW = "min-h-[35px] gap-2 border-t-0! px-3 py-2 text-[13px] leading-[19px] text-foreground focus:text-foreground [&_svg]:size-[18px]";

/**
 * The client page, laid out as Workiz's (/root/client/<id>,
 * pg_contact_wz_269669_*): the 300px column on the left (name, contact, tags,
 * folds); the totals and "Create new" over the tabs — Jobs, Estimates,
 * Invoices, Payments, Addresses, Calls — each a Workiz grid; the Notes /
 * History / Files rail on the right, its panels laid over the page.
 *
 * Workiz's Custom fields tab and More (Service plans, Visits, Leads,
 * Equipment) have nothing behind them in BitCRM and are left out.
 */
export function ContactDetailPage({ contactId }: { contactId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  // Everything the card shows, asked for at once; the card goes up whole.
  const { ready } = useClientPageData(contactId);
  const { data: contact } = useContact(contactId);
  const { data: company } = useCompany(contact?.companyId ?? "");
  const del = useDeleteContact();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [tab, setTab] = useState<TabId>("jobs");
  const [chatOpen, setChatOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [addressMode, setAddressMode] = useState<AddressSheetMode | null>(null);
  const [payOpen, setPayOpen] = useState(false);

  const money = can("financials", "view");
  // The client's jobs and nothing else: a `sort=schedule` here once took the
  // schedule index, which has no client key, and the card showed the whole
  // account. The order Workiz shows (by job date) is applied below. Every
  // page is walked by `useClientPageData`.
  const jobs = useClientJobs(contactId);
  const jobPages = useMemo(() => jobs.data?.pages.map((p) => p.data) ?? [], [jobs.data]);
  const deals = useMemo<Deal[]>(() => jobPages.flat().sort(byJobDateDesc), [jobPages]);
  const invoices = useInvoicesForContacts([contactId], can("invoices"));
  const estimates = useEstimatesForContacts([contactId], can("estimates"));
  // The client's payments, every page, so the tab's badge is a number and the
  // tab itself pages them locally (as Jobs does).
  const canPayments = can("payments");
  const payments = useClientPayments(contactId, canPayments);
  const paymentPages = useMemo(() => payments.data?.pages.map((p) => p.items) ?? [], [payments.data]);
  const paymentRows = useMemo(() => paymentPages.flat(), [paymentPages]);
  const morePayments = payments.hasNextPage;
  // Workiz: Create new → Estimate / Invoice make the client's document at once
  // (no job — "either a job or a client") and open it on its own page.
  const createEstimate = useCreateClientEstimate();
  const createInvoice = useCreateClientInvoice();
  // The Job Date column is on the account's clock: a visit is stored on the
  // clock of the zone it was booked in — the job's own, else its area's.
  const { data: serviceAreas } = useServiceAreas();
  const areaZone = useMemo(() => new Map((serviceAreas ?? []).map((a) => [a.id, a.timezone])), [serviceAreas]);
  const zoneOf = useCallback((d: Deal) => d.jobTimezone || (d.serviceAreaId ? areaZone.get(d.serviceAreaId) : undefined), [areaZone]);

  const today = accountToday();
  const kpis = useMemo(
    () => clientKpis(invoices.data ?? [], estimates.data ?? [], today, canPayments ? paymentRows : undefined),
    [invoices.data, estimates.data, today, canPayments, paymentRows],
  );
  const amountDue = useMemo(() => amountDueByDeal(invoices.data ?? []), [invoices.data]);
  const pastDue = useMemo(() => pastDueByDeal(invoices.data ?? [], today), [invoices.data, today]);
  const addressRows = useMemo(
    () => (contact ? clientAddressRows(contact, deals, { due: amountDue, pastDue }) : []),
    [contact, deals, amountDue, pastDue],
  );
  const dealsById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  const hasNextPage = jobs.hasNextPage;

  if (!ready || !contact) {
    return (
      <div className="p-6">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const remove = () => del.mutate(contact.id, { onSuccess: () => router.push("/contacts") });
  // A big client's numbers say "at least" while the rest of its pages are
  // counted, and change once, when the count is final.
  const jobsCount = countSoFar(jobPages, hasNextPage);
  const paymentsCount = countSoFar(paymentPages, morePayments);
  const addressesCount = countSoFar(jobPages, hasNextPage, (rows) => clientAddressRows(contact, rows).length);
  // Taking money is `payments.collect` (POST /invoices/:id/payments); the registry has no `payments.create`.
  const canPay = can("invoices") && can("payments", "collect");

  const tabs: WzTab[] = [
    { value: "jobs", label: "Jobs", count: jobsCount },
    ...(can("estimates") ? [{ value: "estimates", label: "Estimates", count: String(estimates.data?.length ?? 0) }] : []),
    ...(can("invoices") ? [{ value: "invoices", label: "Invoices", count: String(invoices.data?.length ?? 0) }] : []),
    ...(canPayments ? [{ value: "payments", label: "Payments", count: paymentsCount }] : []),
    { value: "addresses", label: "Addresses", count: addressesCount },
    ...(can("calls") ? [{ value: "calls", label: "Calls" }] : []),
  ];

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto md:mt-3.5 md:flex-row md:overflow-hidden">
      <div className="border-border md:w-[300px] md:shrink-0 md:overflow-y-auto md:border-t md:border-r">
        <ClientSummaryPanel
          contact={contact}
          company={company}
          canEdit={can("contacts", "edit")}
          canDelete={can("contacts", "delete")}
          canCreateTags={can("client_tags", "create")}
          showPortal={can("invoices") || can("estimates")}
          canMessage={can("messages", "send")}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirmDelete(true)}
          onMessage={() => setChatOpen(true)}
          onEditAddress={setAddressMode}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col border-t border-border pt-6 md:overflow-y-auto">
        <div className="mb-5 flex shrink-0 flex-wrap items-start justify-between gap-3 pr-[26px]">
          <ClientKpiStrip kpis={kpis} money={money} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {/* pg_contact_wz_269669_01: a 40px yellow pill, the chevron before the words. */}
              <Button variant="brand" size="lg" className="min-w-[133px] gap-1.5 px-3">
                <ChevronDown className="size-[18px]" strokeWidth={1.75} /> Create new
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              sideOffset={5}
              alignOffset={-8}
              className="w-[236px] min-w-[236px] rounded-[8px] p-2 shadow-[0_0_4px_rgba(59,75,82,0.05),0_8px_16px_rgba(59,75,82,0.15)]"
            >
              {/* Workiz's list in its order, minus what BitCRM has nothing for (Lead, Service Plan). */}
              {can("estimates", "create") ? (
                <DropdownMenuItem
                  className={MENU_ROW}
                  disabled={createEstimate.isPending}
                  onSelect={() => createEstimate.mutate(contact.id, { onSuccess: (e) => router.push(`/estimates/${e.id}`) })}
                >
                  <FileSpreadsheet strokeWidth={1.25} /> Estimate
                </DropdownMenuItem>
              ) : null}
              {can("deals", "create") ? (
                <DropdownMenuItem className={MENU_ROW} onSelect={() => setLocationOpen(true)}>
                  <Wrench strokeWidth={1.25} /> Job
                </DropdownMenuItem>
              ) : null}
              {can("invoices", "create") ? (
                <DropdownMenuItem
                  className={MENU_ROW}
                  disabled={createInvoice.isPending}
                  onSelect={() => createInvoice.mutate(contact.id, { onSuccess: (inv) => router.push(`/invoices/${inv.id}`) })}
                >
                  <FileText strokeWidth={1.25} /> Invoice
                </DropdownMenuItem>
              ) : null}
              {can("messages", "send") ? (
                <DropdownMenuItem className={MENU_ROW} onSelect={() => setChatOpen(true)}>
                  <MessageSquareText strokeWidth={1.25} /> Message
                </DropdownMenuItem>
              ) : null}
              {can("contacts", "edit") ? (
                <DropdownMenuItem className={MENU_ROW} onSelect={() => setAddressMode("new")}>
                  <Home strokeWidth={1.25} /> Address
                </DropdownMenuItem>
              ) : null}
              {canPay ? (
                <DropdownMenuItem className={MENU_ROW} onSelect={() => setPayOpen(true)}>
                  <CreditCard strokeWidth={1.25} /> Pay Invoices
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <WzTabBar aria-label="Client tabs" variant="small" tabs={tabs} value={tab} onValueChange={(v) => setTab(v as TabId)} className="mt-1 -ml-px shrink-0" />

        <div role="tabpanel" aria-label={tabs.find((t) => t.value === tab)?.label} className="min-w-0 shrink-0">
          {tab === "jobs" ? (
            <ClientJobsTab deals={deals} amountDue={amountDue} pastDue={pastDue} money={money} zoneOf={zoneOf} complete={!hasNextPage} />
          ) : tab === "estimates" ? (
            <ClientEstimatesTab estimates={estimates.data ?? []} dealsById={dealsById} serviceAddress={contact.addresses[0]} />
          ) : tab === "invoices" ? (
            <ClientInvoicesTab invoices={invoices.data ?? []} today={today} money={money} onPay={canPay ? () => setPayOpen(true) : undefined} />
          ) : tab === "payments" ? (
            <ClientPaymentsTab rows={paymentRows} dealsById={dealsById} isError={payments.isError} />
          ) : tab === "addresses" ? (
            <ClientAddressesTab rows={addressRows} money={money} complete={!hasNextPage} />
          ) : (
            <ClientCallsTab contactId={contact.id} />
          )}
        </div>
      </div>

      {/* Workiz's right rail: Notes, History, Files — their panels laid over the page. */}
      <ClientRail contact={contact} canEdit={can("contacts", "edit")} />

      <ClientChatSheet contactId={contact.id} name={contactName(contact)} phone={contact.phones[0]} open={chatOpen} onOpenChange={setChatOpen} />
      <ServiceLocationDialog contact={contact} open={locationOpen} onOpenChange={setLocationOpen} />
      <ClientAddressSheet
        key={addressMode ?? "closed"}
        contact={contact}
        mode={addressMode ?? "new"}
        open={addressMode !== null}
        onOpenChange={(o) => !o && setAddressMode(null)}
      />
      <PayInvoicesDialog invoices={invoices.data ?? []} open={payOpen} onOpenChange={setPayOpen} />
      <EditClientDialog
        contact={contact}
        open={editing}
        onOpenChange={setEditing}
        onDelete={
          can("contacts", "delete")
            ? () => {
                setEditing(false);
                setConfirmDelete(true);
              }
            : undefined
        }
      />

      <DeleteClientDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        name={contactName(contact)}
        kind="contact"
        pending={del.isPending}
        onConfirm={remove}
      />
    </div>
  );
}
