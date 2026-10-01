"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, MessageSquareText, StickyNote, Wrench } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { usePermissions } from "@/features/auth/use-permissions";
import { ClientCallsLog } from "@/features/calls/components/client-calls-log";
import { useDealsPage } from "@/features/deals/hooks";
import { useEstimatesForContacts } from "@/features/estimates/hooks";
import { useInvoicesForContacts } from "@/features/invoices/hooks";
import { ClientEstimatesList, ClientInvoicesList } from "@/features/billing/components/client-documents";
import { accountToday } from "@/features/reports/report-dates";
import { amountDueByDeal, clientAddressRows, clientKpis } from "../client-page";
import { useCompany, useContact, useDeleteContact } from "../hooks";
import { contactName } from "../lib";
import { ClientAddressesTab } from "./client-addresses-tab";
import { ClientChatSheet } from "./client-chat-sheet";
import { ClientJobsTab } from "./client-jobs-tab";
import { ClientKpiStrip } from "./client-kpi-strip";
import { ClientPaymentsTab } from "./client-payments-tab";
import { ClientSummaryPanel } from "./client-summary-panel";
import { ContactForm } from "./contact-form";
import { DeleteClientDialog } from "./delete-client-dialog";

const JOBS_PAGE = 50;

/**
 * The client card, laid out as Workiz's (/root/client/<id>): the summary
 * column on the left, the four cards and "Create new" up top, then the
 * tabs — Jobs, Estimates, Invoices, Payments, Addresses, Calls, Messages —
 * and a Notes rail on the right.
 */
export function ContactDetailPage({ contactId }: { contactId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: contact, isLoading } = useContact(contactId);
  const { data: company } = useCompany(contact?.companyId ?? "");
  const del = useDeleteContact();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [tab, setTab] = useState("jobs");
  const [chatOpen, setChatOpen] = useState(false);

  const money = can("financials", "view");
  const jobs = useDealsPage({ contactId, limit: JOBS_PAGE, sort: "schedule", dir: "desc" }, !!contact);
  const deals = useMemo<Deal[]>(() => jobs.data?.pages.flatMap((p) => p.data) ?? [], [jobs.data]);
  const invoices = useInvoicesForContacts([contactId], can("invoices"));
  const estimates = useEstimatesForContacts([contactId], can("estimates"));

  const kpis = useMemo(() => clientKpis(invoices.data ?? [], estimates.data ?? [], accountToday()), [invoices.data, estimates.data]);
  const amountDue = useMemo(() => amountDueByDeal(invoices.data ?? []), [invoices.data]);
  const addressRows = useMemo(() => (contact ? clientAddressRows(contact, deals) : []), [contact, deals]);
  const dealsById = useMemo(() => new Map(deals.map((d) => [d.id, d])), [deals]);

  const { hasNextPage, isFetchingNextPage, fetchNextPage } = jobs;
  const loadAllJobs = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (isLoading || !contact) {
    return (
      <div className="p-6">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const remove = () => del.mutate(contact.id, { onSuccess: () => router.push("/contacts") });
  const jobsCount = `${deals.length}${hasNextPage ? "+" : ""}`;

  if (editing) {
    return (
      <div className="flex flex-1 flex-col overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl p-6">
          <h1 className="mb-4 text-lg font-semibold tracking-tight">{contactName(contact)}</h1>
          <ContactForm contact={contact} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <div className="md:w-80 md:shrink-0 md:overflow-y-auto">
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
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col md:overflow-y-auto">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b px-5 py-4">
          <ClientKpiStrip kpis={kpis} money={money} />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="brand" size="sm" className="gap-1">
                Create new <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {can("deals", "create") ? (
                <DropdownMenuItem asChild>
                  <Link href={`/deals/new?contactId=${contact.id}`}>
                    <Wrench className="size-4" /> Job
                  </Link>
                </DropdownMenuItem>
              ) : null}
              {can("messages", "send") ? (
                <DropdownMenuItem onSelect={() => setChatOpen(true)}>
                  <MessageSquareText className="size-4" /> Message
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="border-b px-5">
            <TabsList variant="line" className="h-11">
              <TabsTrigger value="jobs" className="px-2">
                Jobs <Count n={jobsCount} />
              </TabsTrigger>
              {can("estimates") ? (
                <TabsTrigger value="estimates" className="px-2">
                  Estimates
                </TabsTrigger>
              ) : null}
              {can("invoices") ? (
                <TabsTrigger value="invoices" className="px-2">
                  Invoices
                </TabsTrigger>
              ) : null}
              {can("payments") ? (
                <TabsTrigger value="payments" className="px-2">
                  Payments
                </TabsTrigger>
              ) : null}
              <TabsTrigger value="addresses" className="px-2">
                Addresses <Count n={String(addressRows.length)} />
              </TabsTrigger>
              {can("calls") ? (
                <TabsTrigger value="calls" className="px-2">
                  Calls
                </TabsTrigger>
              ) : null}
            </TabsList>
          </div>

          <TabsContent value="jobs" className="mt-0">
            <ClientJobsTab
              deals={deals}
              amountDue={amountDue}
              money={money}
              isLoading={jobs.isLoading}
              hasMore={!!hasNextPage}
              loadingMore={isFetchingNextPage}
              onMore={() => void fetchNextPage()}
            />
          </TabsContent>
          <TabsContent value="estimates" className="mt-0 p-4">
            <ClientEstimatesList contactIds={[contact.id]} />
          </TabsContent>
          <TabsContent value="invoices" className="mt-0 p-4">
            <ClientInvoicesList contactIds={[contact.id]} />
          </TabsContent>
          <TabsContent value="payments" className="mt-0">
            <ClientPaymentsTab contactId={contact.id} dealsById={dealsById} />
          </TabsContent>
          <TabsContent value="addresses" className="mt-0">
            <ClientAddressesTab rows={addressRows} money={money} complete={!hasNextPage} onNeedAll={loadAllJobs} />
          </TabsContent>
          <TabsContent value="calls" className="mt-0 p-4">
            <ClientCallsLog contactId={contact.id} />
          </TabsContent>
        </Tabs>
      </div>

      <ClientChatSheet contactId={contact.id} name={contactName(contact)} phone={contact.phones[0]} open={chatOpen} onOpenChange={setChatOpen} />

      {/* Workiz's right rail. Notes is the one BitCRM has to show. */}
      <div className="flex shrink-0 gap-2 border-t p-2 md:flex-col md:border-t-0 md:border-l">
        <Button variant="ghost" size="sm" className="flex-col gap-0.5 md:h-14 md:w-14" onClick={() => setNotesOpen(true)} aria-label="Notes">
          <StickyNote className="size-4" />
          <span className="text-[10px]">Notes</span>
        </Button>
      </div>

      <Sheet open={notesOpen} onOpenChange={setNotesOpen}>
        <SheetContent side="right" className="w-96">
          <SheetHeader>
            <SheetTitle>Notes</SheetTitle>
            <SheetDescription>What the office keeps on this client.</SheetDescription>
          </SheetHeader>
          <div className="px-4 text-sm whitespace-pre-wrap">{contact.notes || <span className="text-muted-foreground">No notes yet. Edit the client to add some.</span>}</div>
        </SheetContent>
      </Sheet>

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

function Count({ n }: { n: string }) {
  return <span className="ml-1 rounded-chip bg-muted px-1.5 text-[11px] font-medium text-muted-foreground">{n}</span>;
}
