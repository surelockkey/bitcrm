"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Popover } from "radix-ui";
import { ChevronDown, Download, Eye, Link2, Loader2, Send, SquarePen, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  PaymentTerms,
  ProductType,
  calculateDocumentTotals,
  type Contact,
  type Deal,
  type DealProduct,
  type DocumentTotals,
  type InvoiceView,
  type PaymentSummary,
} from "@bitcrm/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WzButton } from "@/components/workiz/button";
import { WzDayPicker } from "@/components/workiz/day-picker";
import { WZ_TOTALS_BOX, WzDocSectionHead, WzTotalsBoxRow } from "@/components/workiz/document-parts";
import { WZ_MENU_POPUP, WZ_MENU_POPUP_ITEM } from "@/components/workiz/menu-popup";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { todayYmd } from "@/features/billing/dates";
import { formatBoxAmount } from "@/features/billing/lib";
import { useOpenPdf } from "@/features/billing/open-pdf";
import { CommitTextarea } from "@/features/billing/components/document-field";
import { DocumentPreviewDialog } from "@/features/billing/components/document-preview-dialog";
import { DocumentItemsTable, type DocumentLineItem } from "@/features/billing/components/document-items-table";
import { DocumentSummaryPanel } from "@/features/billing/components/document-summary-panel";
import { DocumentTemplateSelect } from "@/features/billing/components/document-template-select";
import { SignaturesSection } from "@/features/billing/components/signatures-section";
import { useContact } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import {
  useDealProducts,
  useDealTotals,
  useRemoveProduct,
  useResetDealTax,
  useSetDealDiscount,
  useSetDealTax,
  useSetProductTaxable,
} from "@/features/deals/hooks";
import { workizDateTime } from "@/features/deals/job-shell";
import { AddProductDialog } from "@/features/deals/components/add-product-dialog";
import { DealAttachmentsTab } from "@/features/deals/components/deal-attachments-tab";
import { useInvoicePayments } from "@/features/payments/hooks";
import { applyAmountPaid } from "@/features/payments/lib";
import { InvoicePaymentsSection } from "@/features/payments/components/invoice-payments-section";
import { RecordPaymentDialog } from "@/features/payments/components/record-payment-dialog";
import {
  AddPaymentScheduleButton,
  PaymentScheduleDialog,
  PaymentScheduleTable,
} from "@/features/payments/components/payment-schedule";
import { usePaymentSchedule, useRefreshScheduleOnTotal } from "@/features/payments/schedule-hooks";
import { CopyPortalLinkButton, useCopyPortalLink } from "@/features/portal/components/copy-portal-link-button";
import { SendDocumentDialog, type SendDocumentChannel } from "@/features/portal/components/send-document-dialog";
import { getInvoiceHtml, getInvoicePdfUrl } from "../api";
import { useDeleteInvoice, useMarkInvoiceSent, useSignInvoice, useUpdateInvoice } from "../hooks";
import { billToLines, formatSlashDate, serviceAddressLines } from "../invoice-header";
import { invoiceStatusCell } from "../invoices-list";
import { PAYMENT_TERMS_OPTIONS, dueDateForTerms } from "../lib";
import { invoiceEditSchema, type InvoicePatch } from "../schemas";
import { toLineItems, useClientInvoiceLines } from "./invoice-items-table";

/*
 * 2026-10-09: Workiz's invoice page (/root/invoice/<serial>/, captures
 * pg_invoice_wz_*: 01_partial, 02_paid, 03_due, 04_nojob). Only the dress
 * changed — every hook, permission and handler is the one this screen had
 * (git 297ae8fe: deal-invoice-tab.tsx InvoiceDetail). Since 2026-10-09 a
 * job's invoice opens here too, on its own page (the job's Invoice tab went).
 *
 *   header-module   the grey header: (a job's: "← Job ID: …") Client:, Actions ▾, Send; Bill to: |
 *                   Service address: | Invoice ID / Invoice date / Sent (and
 *                   ours: Status, Template).
 *   items-module    "Items" and the grid, "+ Add item".
 *   totals-module   Total / Balance (+ Pay) / Due (and ours: Terms) | Subtotal
 *                   … Tax, Item cost, "+ Add payment schedule".
 *   then            Notes | Payments, Attachments | Signatures.
 */

/** The header's right column (h4 150px right-aligned 16px/35px 600, then 15px/35px). */
const H4 = "w-[150px] shrink-0 text-right text-[16px] leading-[35px] font-semibold text-wz-strong";
const VALUE = "min-w-0 text-[15px] leading-[35px] text-wz-strong";
/** "Bill to:" / "Service address:" — 18px/19px 600 #3b4c53, the lines 14px/22px #404040 8px under. */
const COL_TITLE = "text-[18px] leading-[19px] font-semibold text-[#3b4c53]";
/** Workiz's "Sent: No" and owed Balance red (header-module__noSent). */
const WZ_RED = "text-[#dd380d]";

/**
 * One invoice in Workiz's dress — the job's (`deal` given: its lines are the
 * job's items, edited in the job's own item window; its tax and discount the
 * job's) or a client's on its own page (no `deal`: it owns its lines).
 */
export function InvoiceDetail({
  deal,
  invoice,
  canEditItems,
  onDeleted,
  edge = false,
  jobLink,
}: {
  deal?: Deal;
  invoice: InvoiceView;
  canEditItems: boolean;
  /** Where to go once the invoice is deleted (its page has nothing left to show). */
  onDeleted?: () => void;
  /** The page's own column (edge to edge): the items sit 40px in, the sections 20px — Workiz's page. */
  edge?: boolean;
  /** A job's invoice: Workiz's "← Job ID: …" line, drawn first in the grey header. */
  jobLink?: ReactNode;
}) {
  const { can } = usePermissions();
  const canEdit = can("invoices", "edit");
  const canSend = can("invoices", "send");
  const canDelete = can("invoices", "delete");
  const canSeePayments = can("payments");
  // The ledger is keyed by the job: a client invoice (no job) can be read but not paid yet.
  const canCollect = can("payments", "collect") && !!invoice.dealId;
  const update = useUpdateInvoice(invoice);
  const markSent = useMarkInvoiceSent(deal?.id);
  const del = useDeleteInvoice(deal?.id);
  const sign = useSignInvoice(invoice);
  const client = useContact(invoice.contactId);
  const portalLink = useCopyPortalLink(invoice.contactId);
  const pdf = useOpenPdf(() => getInvoicePdfUrl(invoice.id));
  const [previewing, setPreviewing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [sendingVia, setSendingVia] = useState<SendDocumentChannel | null>(null);
  const [paying, setPaying] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const canText = canSend && can("messages", "send");
  // One ledger query for the page: the totals and the payments section read the same cache entry.
  const ledger = useInvoicePayments(invoice.id, canSeePayments);
  const paymentSummary = ledger.data?.summary ?? invoice.paymentSummary;
  // Workiz's Payment schedule belongs to the job (billing: "only for job-connected invoices").
  const schedule = usePaymentSchedule(deal?.id ?? "", !!deal && canSeePayments);

  /** Validate the merged header before sending only what changed. */
  const save = (patch: InvoicePatch) => {
    const merged = {
      invoiceDate: patch.invoiceDate ?? invoice.invoiceDate,
      paymentTerms: patch.paymentTerms ?? invoice.paymentTerms,
      dueDate: patch.dueDate ?? invoice.dueDate,
      notes: patch.notes ?? invoice.notes ?? "",
    };
    const parsed = invoiceEditSchema.safeParse(merged);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid invoice details");
      return;
    }
    update.mutate(patch);
  };

  const c = client.data;
  const custom = invoice.paymentTerms === PaymentTerms.CUSTOM;

  // Workiz's MenuPopup (pg_invoice_wz_05_actions_open): its rows in its order, ours (portal link) before Delete.
  const actionsMenu = (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <WzButton variant="secondary" size="regular" icon={<ChevronDown strokeWidth={1.5} />} iconPosition="end" className="aria-expanded:bg-wz-secondary-hover">
          Actions
        </WzButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} alignOffset={-4} className={WZ_MENU_POPUP}>
        <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={() => setPreviewing(true)}>
          <Eye strokeWidth={1.25} /> Preview
        </DropdownMenuItem>
        <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={() => pdf.open()} disabled={pdf.pending}>
          <Download strokeWidth={1.25} /> Download
        </DropdownMenuItem>
        {canSend ? (
          <DropdownMenuItem
            className={WZ_MENU_POPUP_ITEM}
            disabled={markSent.isPending}
            onSelect={() => markSent.mutate({ id: invoice.id, sent: !invoice.sentAt })}
          >
            {invoice.sentAt ? <Undo2 strokeWidth={1.25} /> : <Send strokeWidth={1.25} />} {invoice.sentAt ? "Mark unsent" : "Mark sent"}
          </DropdownMenuItem>
        ) : null}
        {canSend ? (
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} disabled={portalLink.disabled} onSelect={() => void portalLink.copy()}>
            {portalLink.pending ? <Loader2 className="animate-spin" /> : <Link2 strokeWidth={1.25} />} Copy client portal link
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          <DropdownMenuItem variant="destructive" className={WZ_MENU_POPUP_ITEM} onSelect={() => setDeleting(true)}>
            <Trash2 strokeWidth={1.25} /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // header-module__send: yellow, 110px at the least.
  const sendButton = canText ? (
    <WzButton size="regular" icon={<Send strokeWidth={1.5} />} className="min-w-[110px]" onClick={() => setSendingVia("email")}>
      Send
    </WzButton>
  ) : canSend ? (
    <CopyPortalLinkButton contactId={invoice.contactId} className="h-8" />
  ) : null;

  const lines = (renderTotals: (t: TotalsInput) => ReactNode) =>
    deal ? (
      <JobInvoiceLines deal={deal} canEdit={canEditItems} paymentSummary={paymentSummary} renderTotals={renderTotals} />
    ) : (
      <ClientInvoiceLines invoice={invoice} canEdit={canEditItems} paymentSummary={paymentSummary} renderTotals={renderTotals} />
    );

  const scheduleView = schedule.data ?? null;
  const renderTotals = ({ totals, cost, panel }: TotalsInput) => (
    <>
      <DocumentSummaryPanel
        variant="workiz"
        className="mt-[62px]"
        totals={totals}
        {...panel}
        showPayments
        paymentSummary={paymentSummary}
        onPay={canCollect ? () => setPaying(true) : undefined}
        leftRows={
          <>
            <DueRow
              value={invoice.dueDate}
              editable={canEdit && custom}
              onChange={(dueDate) => dueDate !== invoice.dueDate && save({ dueDate })}
            />
            {/* Ours: the terms that set the due date (Workiz keeps them in its settings). */}
            <TermsRow
              value={invoice.paymentTerms}
              disabled={!canEdit}
              onChange={(paymentTerms) =>
                save({ paymentTerms, dueDate: dueDateForTerms(invoice.invoiceDate, paymentTerms, invoice.dueDate) })
              }
            />
          </>
        }
        extraRows={
          <>
            {cost !== undefined ? <WzTotalsBoxRow label="Item cost">{formatBoxAmount(cost)}</WzTotalsBoxRow> : null}
            {deal && canCollect && !scheduleView && schedule.isSuccess ? (
              <AddPaymentScheduleButton onClick={() => setScheduling(true)} disabled={totals.balanceDue <= 0} />
            ) : null}
          </>
        }
      />
      {deal && scheduleView ? (
        <div className="mt-10">
          <PaymentScheduleTable
            view={scheduleView}
            invoiceId={invoice.id}
            canEdit={canCollect}
            canCollect={canCollect}
            canViewPdf={can("invoices")}
            onEdit={() => setScheduling(true)}
          />
        </div>
      ) : null}
      {canCollect ? (
        <RecordPaymentDialog
          invoiceId={invoice.id}
          dealId={deal?.id}
          balanceDue={totals.balanceDue}
          open={paying}
          onOpenChange={setPaying}
        />
      ) : null}
      {deal && canCollect ? (
        <PaymentScheduleDialog
          open={scheduling}
          onOpenChange={setScheduling}
          dealId={deal.id}
          total={totals.total}
          amountPaid={totals.amountPaid}
          view={scheduleView}
        />
      ) : null}
    </>
  );

  return (
    <div className="pb-10 text-wz-strong">
      <InvoiceHeader
        deal={deal}
        invoice={invoice}
        contact={c}
        paymentSummary={paymentSummary}
        jobLink={jobLink}
        actions={
          <>
            {actionsMenu}
            {sendButton}
          </>
        }
        dateField={
          <DateBox
            id="invoice-date"
            label="Invoice date"
            value={invoice.invoiceDate}
            disabled={!canEdit}
            onChange={(invoiceDate) => {
              if (invoiceDate === invoice.invoiceDate) return;
              const dueDate = dueDateForTerms(invoiceDate, invoice.paymentTerms, invoice.dueDate);
              save(dueDate !== invoice.dueDate ? { invoiceDate, dueDate } : { invoiceDate });
            }}
          />
        }
        templateField={
          <DocumentTemplateSelect
            id="invoice-template"
            kind="invoice"
            value={invoice.templateId}
            disabled={!canEdit}
            onChange={(templateId) => update.mutate({ templateId })}
            className="h-[35px] w-auto max-w-[200px] gap-1.5 rounded-none border-0 bg-transparent p-0 text-[15px] text-wz-strong shadow-none hover:border-0 disabled:bg-transparent disabled:text-wz-strong data-[size=sm]:h-[35px] data-[size=sm]:pl-0 data-[state=open]:shadow-none [&>svg]:size-3.5! [&>svg]:text-wz-caption!"
          />
        }
      />

      <div className={edge ? "px-10" : "px-5"}>{lines(renderTotals)}</div>

      {/* Notes | Payments, then Attachments | Signatures: two columns 40px apart, 60px under the totals. */}
      <div className={cn("mt-[60px] grid grid-cols-1 gap-x-10 gap-y-[70px] lg:grid-cols-2", edge ? "px-5" : "px-0")}>
        <InvoiceNotes notes={invoice.notes ?? ""} canEdit={canEdit} onSave={(notes) => save({ notes })} />
        <InvoicePaymentsSection invoice={invoice} dealId={deal?.id} variant="workiz" />
        {deal ? <DealAttachmentsTab dealId={deal.id} canEdit={canEditItems} /> : null}
        <div id="invoice-signatures" className="min-w-0 lg:col-start-2">
          <SignaturesSection
            variant="workiz"
            signatures={invoice.signatures ?? []}
            signerName={[c?.firstName, c?.lastName].filter(Boolean).join(" ")}
            canSign={canEdit}
            saving={sign.isPending}
            onSign={(input) => sign.mutateAsync(input)}
          />
        </div>
      </div>

      <DocumentPreviewDialog
        open={previewing}
        onOpenChange={setPreviewing}
        title={`Invoice #${invoice.number}`}
        queryKey={queryKeys.invoices.detail(invoice.id)}
        fetchHtml={() => getInvoiceHtml(invoice.id)}
        onDownload={pdf.open}
        downloadPending={pdf.pending}
      />

      {canText ? (
        <SendDocumentDialog
          channel={sendingVia ?? "sms"}
          open={sendingVia !== null}
          onOpenChange={(o) => !o && setSendingVia(null)}
          document={{
            kind: "invoice",
            id: invoice.id,
            number: invoice.number,
            total: invoice.totals?.total ?? 0,
            contactId: invoice.contactId,
            dealId: deal?.id,
            businessProfileId: deal?.businessProfileId,
            alreadySent: !!invoice.sentAt,
            allowedMethods: invoice.allowedMethods,
            requestSignature: invoice.requestSignature,
            display: invoice.display,
          }}
          markSent={() => markSent.mutateAsync({ id: invoice.id, sent: true })}
        />
      ) : null}

      <AlertDialog open={deleting} onOpenChange={setDeleting}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete invoice #{invoice.number}?</AlertDialogTitle>
            <AlertDialogDescription>
              {deal
                ? "The invoice is removed from the invoices list and the client portal. The items stay on the job — you can create the invoice again later."
                : "The invoice and its items are removed from the invoices list, the client's card and the client portal."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => del.mutate(invoice.id, { onSuccess: onDeleted })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* --------------------------------------------------------------- header */

/**
 * header-module (pg_invoice_wz_01_partial / _04_nojob): #f7f8f8, 20px in;
 * "Client: <name>" 18px/30px (the name a 600 link) with Actions / Send at the
 * right; under it Bill to: | Service address: (a job's) | the facts column.
 * A job's invoice carries Workiz's "← Job ID: XYB3JT" line first (22px down,
 * the Client row 23px under it, the header 20px taller); without a job the
 * Client row sits 45px down.
 */
function InvoiceHeader({
  deal,
  invoice,
  contact,
  paymentSummary,
  jobLink,
  actions,
  dateField,
  templateField,
}: {
  deal?: Deal;
  jobLink?: ReactNode;
  invoice: InvoiceView;
  contact: Contact | undefined;
  paymentSummary: PaymentSummary | undefined;
  actions: ReactNode;
  dateField: ReactNode;
  templateField: ReactNode;
}) {
  const billTo = contact?.billingAddress ?? contact?.addresses?.[0];
  const status = invoiceStatusCell(
    { status: invoice.status, balance: applyAmountPaid(invoice.totals, paymentSummary?.settled ?? invoice.totals.amountPaid).balanceDue },
    { amountPaid: paymentSummary?.settled ?? invoice.totals.amountPaid },
    invoice.sentAt,
  );
  const signature = invoice.signedAt ? "Signed" : invoice.requestSignature ? "Signature requested" : null;

  return (
    <section aria-label="Invoice details" className={cn("bg-wz-tile px-5 pb-5", jobLink ? "pt-[22px]" : "pt-[45px]")}>
      {/* header-module__jobLink: 22px down, a 20px line, the Client row 23px under it (y 114 → 157). */}
      {jobLink ? <div className="flex h-5 items-center">{jobLink}</div> : null}
      <div className={cn("flex flex-wrap items-start justify-between gap-3", jobLink && "mt-[23px]")}>
        <p className="flex min-h-[34px] min-w-0 flex-wrap items-center gap-x-3 text-[18px] leading-[30px] font-medium text-wz-strong">
          <span>
            Client:{" "}
            <Link href={`/contacts/${invoice.contactId}`} className="font-semibold text-[#3b4c53] hover:underline">
              {contact ? contactName(contact) : "the client"}
            </Link>
          </span>
          {contact?.taxExempt ? (
            // Typography micro: 10px/14px 500 white on #566d76, r16.
            <span title={contact.taxExemptReason} className="rounded-[16px] bg-wz-slate px-3 text-[10px] leading-[18px] font-medium text-white uppercase">
              Tax exempt
            </span>
          ) : null}
        </p>
        <div className="flex shrink-0 items-center gap-3">{actions}</div>
      </div>

      <div className="mt-[15px] grid grid-cols-1 gap-x-[13px] gap-y-5 md:grid-cols-3">
        <div className="min-w-0 pt-2">
          <p className={COL_TITLE}>Bill to:</p>
          <div className="mt-2 text-[14px] leading-[22px] text-wz-strong">
            {billToLines(contact).map((l, i) => (
              <p key={i} className="truncate">
                {l}
              </p>
            ))}
          </div>
        </div>
        <div className="min-w-0 pt-2">
          {deal ? (
            <>
              <p className={COL_TITLE}>Service address:</p>
              <div className="mt-2 text-[14px] leading-[22px] text-wz-strong">
                {serviceAddressLines(deal.address, billTo).map((l, i) => (
                  <p key={i} className="truncate">
                    {l}
                  </p>
                ))}
              </div>
            </>
          ) : null}
        </div>
        <dl className="min-w-0">
          <div className="flex items-center gap-2.5">
            <dt className={H4}>Invoice ID:</dt>
            <dd className={VALUE}>{invoice.number}</dd>
          </div>
          {invoice.workizName ? (
            <div className="flex items-center gap-2.5">
              <dt className={H4}>Invoice name:</dt>
              <dd className={cn(VALUE, "truncate")}>{invoice.workizName}</dd>
            </div>
          ) : null}
          <div className="flex items-center gap-2.5">
            <dt className={H4}>
              <label htmlFor="invoice-date">Invoice date</label>:
            </dt>
            <dd>{dateField}</dd>
          </div>
          <div className="flex items-center gap-2.5">
            <dt className={H4}>Sent:</dt>
            <dd className={cn(VALUE, !invoice.sentAt && WZ_RED)}>{invoice.sentAt ? workizDateTime(invoice.sentAt) : "No"}</dd>
          </div>
          {/* Ours: where the invoice stands (Workiz's list colours) and what the portal asks of it. */}
          <div className="flex items-center gap-2.5">
            <dt className={H4}>Status:</dt>
            <dd className={VALUE}>
              <span className={status.className}>{status.word}</span>
              {status.partial ? <span className="text-wz-caption"> · Partially paid</span> : null}
              {signature ? <span className="text-wz-caption"> · {signature}</span> : null}
            </dd>
          </div>
          <div className="flex items-center gap-2.5">
            <dt className={H4}>
              <label htmlFor="invoice-template">Template</label>:
            </dt>
            <dd className="min-w-0">{templateField}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

/**
 * Workiz's date box (header-module__invoiceDate): 179×34 #f7f7f7 r2, the day
 * underlined 16px #666 — opening react-datepicker's month; a pick saves.
 */
function DateBox({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (ymd: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const look = "flex h-[34px] w-[179px] items-center rounded-[2px] bg-[#f7f7f7] pr-2.5 text-left text-[16px] leading-[30px] tracking-normal text-wz-text underline";
  if (disabled) {
    return (
      <span id={id} aria-label={label} className={look}>
        {formatSlashDate(value)}
      </span>
    );
  }
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button id={id} type="button" aria-label={label} className={cn(look, "outline-none focus-visible:ring-2 focus-visible:ring-wz-focus")}>
          {formatSlashDate(value)}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="start" sideOffset={10} className="z-50 outline-none">
          <WzDayPicker
            value={value}
            today={todayYmd()}
            onSelect={(day) => {
              setOpen(false);
              onChange(day);
            }}
          />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** "Due :" and its grey box (totals-module); a calendar on it while the terms are Custom. */
function DueRow({ value, editable, onChange }: { value: string; editable: boolean; onChange: (ymd: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="group" aria-label="Due" className="flex items-center gap-2.5">
      <span className="text-[14px] leading-5 text-wz-strong">Due :</span>
      {editable ? (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger asChild>
            <button type="button" aria-label="Due date" className={cn(WZ_TOTALS_BOX, "cursor-pointer hover:border-wz-link")}>
              {formatSlashDate(value)}
            </button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content align="start" sideOffset={10} className="z-50 outline-none">
              <WzDayPicker
                value={value}
                today={todayYmd()}
                onSelect={(day) => {
                  setOpen(false);
                  onChange(day);
                }}
              />
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      ) : (
        <span className={WZ_TOTALS_BOX} title="Set by the payment terms — pick Custom to choose a date">
          {formatSlashDate(value)}
        </span>
      )}
    </div>
  );
}

/** Ours: the payment terms as a totals row — the box is the picker. */
function TermsRow({ value, disabled, onChange }: { value: PaymentTerms; disabled: boolean; onChange: (t: PaymentTerms) => void }) {
  return (
    <div role="group" aria-label="Terms" className="flex items-center gap-2.5">
      <span className="text-[14px] leading-5 text-wz-strong">Terms :</span>
      <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as PaymentTerms)}>
        <SelectTrigger
          size="sm"
          aria-label="Payment terms"
          className="h-7! w-[132px] rounded-[2px]! border-input bg-[#f7f7f7] px-2.5 text-[14px] tracking-normal text-wz-text shadow-none disabled:opacity-100 data-[size=sm]:h-7"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PAYMENT_TERMS_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

/* ----------------------------------------------------------- notes */

/**
 * Notes (estimate-module title + notes-module): the head over a #ccc rule;
 * the note and "(Edit)", or — none yet — Workiz's five pale bars with
 * "(+Add)" after the last. Editing opens the box; leaving it saves.
 */
function InvoiceNotes({ notes, canEdit, onSave }: { notes: string; canEdit: boolean; onSave: (notes: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <section aria-label="Notes" className="min-w-0">
      <WzDocSectionHead title="Notes" icon={<SquarePen strokeWidth={1.25} />} className="border-input pb-[15px]" />
      {editing ? (
        <CommitTextarea
          id="invoice-notes"
          aria-label="Invoice notes"
          autoFocus
          rows={4}
          maxLength={5000}
          placeholder="Shown on the invoice (payment instructions, thank-you note…)"
          value={notes}
          onBlurCapture={() => setEditing(false)}
          onCommit={onSave}
          className="mt-5 text-[14px] leading-4"
        />
      ) : notes ? (
        <div className="mt-5">
          <p className="text-[14px] leading-4 break-words whitespace-pre-line">{notes}</p>
          {canEdit ? (
            <button type="button" onClick={() => setEditing(true)} className="mt-2.5 text-[13px] leading-4 font-medium text-wz-link hover:underline">
              (Edit)
            </button>
          ) : null}
        </div>
      ) : (
        // notes-module (pg_invoice_wz_01_partial): 8px #ecedee bars, 24px apart, from 26px under the head.
        <div className="relative mt-[26px] mr-2 flex flex-col gap-4" aria-hidden={!canEdit || undefined}>
          {["w-full", "w-full", "w-1/2", "w-full", "w-1/2"].map((w, i) => (
            <span key={i} aria-hidden className={cn("block h-2 rounded-[8px] bg-[#ecedee]", w)} />
          ))}
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="absolute bottom-0 left-[calc(50%+7px)] text-[13px] leading-4 font-medium text-wz-link hover:underline"
            >
              (+Add)
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------- lines */

interface TotalsInput {
  totals: DocumentTotals;
  /** Item cost (financials.view); undefined hides the row. */
  cost: number | undefined;
  /** What the summary panel needs of the document's tax and discount. */
  panel: Pick<
    React.ComponentProps<typeof DocumentSummaryPanel>,
    | "taxRateId"
    | "taxRateName"
    | "taxSource"
    | "discount"
    | "canEdit"
    | "pending"
    | "onTaxChange"
    | "onResetTaxAuto"
    | "onDiscountChange"
    | "exemptLabel"
  >;
}

const ITEMS_TITLE = (
  // items-module__subWrapper: "Items" 18px/22px 600 over a #cad3d6 rule, 10px under; the grid 15px down.
  <div className="border-b border-wz-rule pb-2.5">
    <h3 id="invoice-items-heading" className="text-[18px] leading-[22px] font-semibold">
      Items
    </h3>
  </div>
);

/** A job line as a document line: a service is a service, a part a product, a Workiz line neither. */
function toJobLine(p: DealProduct, position: number): DocumentLineItem {
  const f = p.fulfillment ?? "sourced";
  return {
    lineId: p.lineId,
    position,
    productId: p.productId,
    productType: f === "service" ? ProductType.SERVICE : f === "imported" ? undefined : ProductType.PRODUCT,
    name: p.name,
    sku: p.sku,
    description: p.description,
    quantity: p.quantity,
    priceClient: p.priceClient,
    costCompany: p.costCompany,
    costForTech: p.costForTech,
    taxable: p.taxable !== false,
  };
}

/**
 * A job's invoice: its lines are the job's items (Workiz: one invoice per job,
 * kept with it), shown in Workiz's grid and edited in the job's own item
 * window; its tax and discount the job's. The wiring is the job Items tab's.
 */
function JobInvoiceLines({
  deal,
  canEdit,
  paymentSummary,
  renderTotals,
}: {
  deal: Deal;
  canEdit: boolean;
  paymentSummary: PaymentSummary | undefined;
  renderTotals: (t: TotalsInput) => ReactNode;
}) {
  const { can } = usePermissions();
  const { data: products } = useDealProducts(deal.id);
  const totalsQuery = useDealTotals(deal.id);
  const remove = useRemoveProduct(deal.id);
  const setTaxable = useSetProductTaxable(deal.id);
  const setTax = useSetDealTax(deal.id);
  const resetTax = useResetDealTax(deal.id);
  const setDiscount = useSetDealDiscount(deal.id);
  const { data: contact } = useContact(deal.taxSource === "exempt" ? deal.contactId : "");
  const [itemWindow, setItemWindow] = useState<{ editing?: DealProduct } | null>(null);

  const items = useMemo(() => products ?? [], [products]);
  // Server totals are authoritative; until they arrive (or while a line edit
  // is refetching) the same shared formula runs on the local items.
  const localTotals = useMemo(
    () => calculateDocumentTotals({ lines: items, taxRatePercent: deal.taxRatePercent, discount: deal.discount }),
    [items, deal.taxRatePercent, deal.discount],
  );
  const snapshot = totalsQuery.data && !totalsQuery.isFetching ? totalsQuery.data : localTotals;
  // The schedule's dollars are shares of this total: a new total, a schedule to read again.
  useRefreshScheduleOnTotal(deal.id, snapshot.total);
  // The ledger, when there is one, restates what is paid.
  const totals = paymentSummary ? applyAmountPaid(snapshot, paymentSummary.settled) : snapshot;
  const lines = useMemo(() => items.map(toJobLine), [items]);

  return (
    <>
      <section aria-labelledby="invoice-items-heading" className="pt-10">
        {ITEMS_TITLE}
        <div className="-mt-[5px]">
          <DocumentItemsTable
            variant="workiz"
            items={lines}
            canEdit={canEdit}
            showCost={can("financials", "view")}
            emptyText="No items on this job yet."
            emptyAction="Add line items"
            addHeightClassName="h-8"
            reorderable={false}
            inlineEdit={false}
            pending={{ add: false, update: false, removingLineId: remove.isPending ? remove.variables : undefined }}
            onOpenLine={(lineId) => setItemWindow({ editing: lineId ? items.find((p) => p.lineId === lineId) : undefined })}
            onAdd={() => {}}
            onUpdate={() => {}}
            onRemove={(lineId) => remove.mutate(lineId)}
            onReorder={() => {}}
            onTaxable={(lineId, taxable) => setTaxable.mutate({ lineId, taxable })}
          />
        </div>
      </section>
      {renderTotals({
        totals,
        cost: can("financials", "view") ? deal.totals?.cost : undefined,
        panel: {
          taxRateId: deal.taxRateId,
          taxRateName: deal.taxRateName,
          taxSource: deal.taxSource,
          discount: deal.discount,
          canEdit,
          pending: setTax.isPending || resetTax.isPending || setDiscount.isPending,
          onTaxChange: (taxRateId) => setTax.mutate(taxRateId),
          onResetTaxAuto: () => resetTax.mutate(),
          onDiscountChange: (d) => setDiscount.mutate(d),
          exemptLabel: contact?.taxExemptReason,
        },
      })}
      <AddProductDialog
        dealId={deal.id}
        techIds={deal.assignedTechIds}
        open={itemWindow !== null}
        editing={itemWindow?.editing}
        onOpenChange={(v) => setItemWindow(v ? (itemWindow ?? {}) : null)}
      />
    </>
  );
}

/** A client's invoice (no job): it owns its lines, tax and discount. */
function ClientInvoiceLines({
  invoice,
  canEdit,
  paymentSummary,
  renderTotals,
}: {
  invoice: InvoiceView;
  canEdit: boolean;
  paymentSummary: PaymentSummary | undefined;
  renderTotals: (t: TotalsInput) => ReactNode;
}) {
  const { can } = usePermissions();
  const canEditInvoice = can("invoices", "edit");
  const update = useUpdateInvoice(invoice);
  const grid = useClientInvoiceLines(invoice.id);
  const lines = useMemo(() => toLineItems(invoice.items), [invoice.items]);
  const totals = paymentSummary ? applyAmountPaid(invoice.totals, paymentSummary.settled) : invoice.totals;
  const cost = lines.reduce((sum, l) => sum + l.costCompany * l.quantity, 0);

  return (
    <>
      <section aria-labelledby="invoice-items-heading" className="pt-10">
        {ITEMS_TITLE}
        <div className="-mt-[5px]">
          <DocumentItemsTable
            variant="workiz"
            items={lines}
            canEdit={canEdit}
            showCost={can("financials", "view")}
            emptyText="No items on this invoice yet."
            emptyAction="Add line items"
            addHeightClassName="h-8"
            {...grid}
          />
        </div>
      </section>
      {renderTotals({
        totals,
        cost: can("financials", "view") ? cost : undefined,
        panel: {
          taxRateId: invoice.taxRateId,
          taxRateName: invoice.taxRateName,
          taxSource: invoice.taxSource,
          discount: invoice.discount,
          canEdit: canEditInvoice,
          pending: update.isPending && (update.variables?.taxRateId !== undefined || update.variables?.discount !== undefined),
          onTaxChange: (taxRateId) => update.mutate({ taxRateId }),
          onDiscountChange: (discount) => update.mutate({ discount }),
        },
      })}
    </>
  );
}
