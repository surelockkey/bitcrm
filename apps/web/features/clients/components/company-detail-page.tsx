"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MessageSquareText, Plus, UserPlus } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { WzLeftBorderBox, WzTotalsBar } from "@/components/workiz/record-parts";
import { WzTabBar, type WzTab } from "@/components/workiz/tab-bar";
import { usePermissions } from "@/features/auth/use-permissions";
import { formatMoney } from "@/features/deals/lib";
import { accountToday } from "@/features/reports/report-dates";
import { clientKpis } from "../client-page";
import { useCompanyPageData } from "../company-page-data";
import { useDeleteCompany } from "../hooks";
import { ClientEstimatesTab, ClientInvoicesTab } from "./client-billing-tabs";
import { CompanyComplianceTab } from "./company-compliance-tab";
import { CompanyForm } from "./company-form";
import { CompanyRail, type CompanyRailPanel } from "./company-rail";
import { CompanySummaryPanel } from "./company-summary-panel";
import { ContactForm } from "./contact-form";
import { ContactsTable } from "./contacts-table";
import { DeleteClientDialog } from "./delete-client-dialog";

type TabId = "contacts" | "estimates" | "invoices" | "compliance";

/** Workiz's Create new rows (`MenuPopup`): 35px, 8px 12px, 13px/19px ink, an 18px glyph. */
const MENU_ROW = "min-h-[35px] gap-2 border-t-0! px-3 py-2 text-[13px] leading-[19px] text-foreground focus:text-foreground [&_svg]:size-[18px]";

/** The estimates' jobs are not on this page; their Address / Job cells stay as the documents carry them. */
const NO_DEALS = new Map<string, Deal>();

/**
 * The company page. Workiz has no companies — its client's "Company name" is
 * a field — so the page is drawn as Workiz's client page
 * (`/root/client/<id>/`, pg_contact_wz_269669_* — the sibling of our
 * `/contacts/[id]`): the 300px column on the left (name, ⋮, type, CONTACT,
 * PLATINUM, Addresses); the totals of the company's people's documents and
 * "Create new" over small tabs — Contacts (the people linked to it, the
 * company's representatives), Estimates, Invoices (everyone's), Compliance
 * (ours: terms and W-9 / COI) — each a Workiz grid; the rail on the right
 * (Notes, Messages), its panels laid over the page.
 *
 * Workiz's Jobs / Payments / Addresses / Calls tabs, AI insights and Custom
 * fields have no company behind them in BitCRM and are left out.
 */
export function CompanyDetailPage({ companyId }: { companyId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  // Everything on the page, asked for at once; the page goes up whole.
  const { ready, company, people, invoices, estimates } = useCompanyPageData(companyId);
  const del = useDeleteCompany();
  const [tab, setTab] = useState<TabId>("contacts");
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [panel, setPanel] = useState<CompanyRailPanel | null>(null);

  const today = accountToday();
  // TOTAL REVENUE here is what the invoices say was paid: the payments are
  // read per client, and a company's people are many.
  const kpis = useMemo(() => clientKpis(invoices, estimates, today), [invoices, estimates, today]);

  if (!ready || !company) {
    return (
      <div className="p-6">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const money = can("financials", "view") && can("invoices");
  const canAddContact = can("contacts", "create");
  const canMessage = can("messages", "send");
  const remove = () => del.mutate(company.id, { onSuccess: () => router.push("/companies") });

  const tabs: WzTab[] = [
    { value: "contacts", label: "Contacts", count: String(people.length) },
    ...(can("estimates") ? [{ value: "estimates", label: "Estimates", count: String(estimates.length) }] : []),
    ...(can("invoices") ? [{ value: "invoices", label: "Invoices", count: String(invoices.length) }] : []),
    { value: "compliance", label: "Compliance" },
  ];
  const shown = tabs.some((t) => t.value === tab) ? tab : "contacts";

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-y-auto md:mt-3.5 md:flex-row md:overflow-hidden">
      <div className="border-border md:w-[300px] md:shrink-0 md:overflow-y-auto md:border-t md:border-r">
        <CompanySummaryPanel
          company={company}
          canEdit={can("companies", "edit")}
          canDelete={can("companies", "delete")}
          canMessage={canMessage}
          onEdit={() => setEditing(true)}
          onDelete={() => setConfirmDelete(true)}
          onMessage={() => setPanel("messages")}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col border-t border-border pt-6 md:overflow-y-auto">
        <div className="mb-5 flex min-h-10 shrink-0 flex-wrap items-start justify-between gap-3 pr-[26px]">
          {/* Workiz's totals (`client-module__totals`), over the company's people's documents. */}
          <WzTotalsBar aria-label="Company totals" className="pt-0.5 max-md:gap-x-10 max-md:pl-5">
            {money ? (
              <>
                <WzLeftBorderBox label="Past due" value={formatMoney(kpis.pastDue)} tone="danger" />
                <WzLeftBorderBox label="Due" value={formatMoney(kpis.due)} />
                <WzLeftBorderBox label="Total revenue" value={formatMoney(kpis.totalRevenue)} />
              </>
            ) : null}
            {can("estimates") ? <WzLeftBorderBox label="Estimates" value={String(kpis.estimates)} /> : null}
          </WzTotalsBar>
          {canAddContact || canMessage ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                {/* pg_contact_wz_269669_01: a 40px yellow pill, the chevron before the words. */}
                <Button variant="brand" size="lg" className="min-w-[133px] gap-1.5 px-3 max-md:ml-5">
                  <ChevronDown className="size-[18px]" strokeWidth={1.75} /> Create new
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                sideOffset={5}
                alignOffset={-8}
                className="w-[236px] min-w-[236px] rounded-[8px] p-2 shadow-[0_0_4px_rgba(59,75,82,0.05),0_8px_16px_rgba(59,75,82,0.15)]"
              >
                {/* What a company can have made from its page: a person linked to it, a text to it. */}
                {canAddContact ? (
                  <DropdownMenuItem className={MENU_ROW} onSelect={() => setAddingContact(true)}>
                    <UserPlus strokeWidth={1.25} /> Contact
                  </DropdownMenuItem>
                ) : null}
                {canMessage ? (
                  <DropdownMenuItem className={MENU_ROW} onSelect={() => setPanel("messages")}>
                    <MessageSquareText strokeWidth={1.25} /> Message
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <WzTabBar aria-label="Company tabs" variant="small" tabs={tabs} value={shown} onValueChange={(v) => setTab(v as TabId)} className="mt-1 -ml-px shrink-0" />

        <div role="tabpanel" aria-label={tabs.find((t) => t.value === shown)?.label} className="min-w-0 shrink-0">
          {shown === "contacts" ? (
            <ContactsTable
              contacts={people}
              toolbar={
                canAddContact ? (
                  // Where the client page's Invoices tab puts "Pay unpaid invoices": a glyph and 14px #6aa8ee words after the Search.
                  <button
                    type="button"
                    onClick={() => setAddingContact(true)}
                    className="ml-[15px] inline-flex items-center gap-2 text-sm leading-[21px] font-medium tracking-[0.4px] text-wz-link outline-none hover:underline focus-visible:underline"
                  >
                    <Plus className="size-[18px]" strokeWidth={1.5} /> Add contact
                  </button>
                ) : null
              }
            />
          ) : shown === "estimates" ? (
            <ClientEstimatesTab estimates={estimates} dealsById={NO_DEALS} />
          ) : shown === "invoices" ? (
            <ClientInvoicesTab invoices={invoices} today={today} money={money} />
          ) : (
            <CompanyComplianceTab company={company} />
          )}
        </div>
      </div>

      {/* Workiz's right rail: Notes, and ours — the company's Messages — their panels laid over the page. */}
      <CompanyRail
        company={company}
        canEdit={can("companies", "edit")}
        canMessages={can("messages")}
        panel={panel}
        onPanelChange={setPanel}
        onEditNotes={() => setEditing(true)}
      />

      {/* Workiz's "Edit client info" is a modal over the card; the company's form lives in one too. */}
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit company info</DialogTitle>
          </DialogHeader>
          <CompanyForm company={company} onCancel={() => setEditing(false)} onDone={() => setEditing(false)} />
        </DialogContent>
      </Dialog>

      <DeleteClientDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        name={company.title}
        kind="company"
        pending={del.isPending}
        onConfirm={remove}
      />

      <Dialog open={addingContact} onOpenChange={setAddingContact}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New contact · {company.title}</DialogTitle>
          </DialogHeader>
          <ContactForm defaultCompanyId={company.id} onCancel={() => setAddingContact(false)} onDone={() => setAddingContact(false)} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
