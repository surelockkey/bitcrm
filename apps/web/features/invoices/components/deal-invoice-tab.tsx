"use client";

import { useState } from "react";
import { ChevronDown, Download, Eye, FileText, Link2, Loader2, Send, Trash2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { PaymentTerms, type Deal, type InvoiceView } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatPhone } from "@/lib/phone";
import { contactName, formatAddress } from "@/features/clients/lib";
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
import { queryKeys } from "@/lib/query-keys";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealProducts } from "@/features/deals/hooks";
import { DealProductsTab } from "@/features/deals/components/deal-products-tab";
import { formatYmd } from "@/features/billing/dates";
import { useOpenPdf } from "@/features/billing/open-pdf";
import { CommitInput, CommitTextarea, DocField } from "@/features/billing/components/document-field";
import { DocumentPreviewDialog } from "@/features/billing/components/document-preview-dialog";
import { DocumentSummaryPanel } from "@/features/billing/components/document-summary-panel";
import { DocumentTemplateSelect } from "@/features/billing/components/document-template-select";
import { CopyPortalLinkButton, useCopyPortalLink } from "@/features/portal/components/copy-portal-link-button";
import { SignaturesSection } from "@/features/billing/components/signatures-section";
import { useContact } from "@/features/clients/hooks";
import { useInvoicePayments } from "@/features/payments/hooks";
import { applyAmountPaid, isPartiallyPaid } from "@/features/payments/lib";
import { PartiallyPaidBadge } from "@/features/payments/components/payment-status-badge";
import { InvoicePaymentsSection } from "@/features/payments/components/invoice-payments-section";
import { SendDocumentDialog, type SendDocumentChannel } from "@/features/portal/components/send-document-dialog";
import { getInvoiceHtml, getInvoicePdfUrl } from "../api";
import {
  useCreateInvoice,
  useDeleteInvoice,
  useInvoiceByDeal,
  useMarkInvoiceSent,
  useSignInvoice,
  useUpdateInvoice,
} from "../hooks";
import { useInvoiceViewData } from "../invoice-view-data";
import { PAYMENT_TERMS_OPTIONS, canCreateInvoice, dueDateForTerms } from "../lib";
import { invoiceEditSchema, type InvoicePatch } from "../schemas";
import { InvoiceItemsTable } from "./invoice-items-table";
import { InvoiceStatusBadge } from "./invoice-status-badge";

/**
 * The job's Invoice tab (Workiz): one invoice per job whose items, tax and
 * discount ARE the job's — so the items table here is the job's own.
 */
export function DealInvoiceTab({ deal, canEditItems }: { deal: Deal; canEditItems: boolean }) {
  const { can } = usePermissions();
  const { data: invoice, isError, error, refetch } = useInvoiceByDeal(deal.id);
  // The tab comes up whole — the invoice with the job's items, its payments
  // and its pickers — rather than filling in and pushing its sections down.
  // A new invoice (made from "No invoice yet") is a new first frame.
  const { allIn } = useInvoiceViewData({ invoice, deal, canEditItems });
  const ready = usePageReady(allIn, invoice?.id ?? "none");

  if (isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(error, "Couldn't load the invoice")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }
  if (!ready) return <Skeleton className="h-48 w-full" />;
  if (!invoice) return <NoInvoice deal={deal} canCreate={can("invoices", "create")} />;
  return <InvoiceDetail deal={deal} invoice={invoice} canEditItems={canEditItems} />;
}

function NoInvoice({ deal, canCreate }: { deal: Deal; canCreate: boolean }) {
  const { data: products, isLoading } = useDealProducts(deal.id);
  const create = useCreateInvoice();
  const check = canCreateInvoice(products?.length ?? deal.itemCount ?? 0);

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-6 py-12 text-center">
      <span className="flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <FileText className="size-5" />
      </span>
      <div>
        <h3 className="font-medium">No invoice yet</h3>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          The invoice uses this job&apos;s items, tax and discount, and stays in sync with them.
        </p>
      </div>
      {canCreate ? (
        check.allowed ? (
          <Button variant="brand" size="sm" onClick={() => create.mutate(deal.id)} disabled={create.isPending || isLoading}>
            {create.isPending ? <Loader2 className="animate-spin" /> : <FileText />} Create invoice
          </Button>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* aria-disabled keeps it focusable so the tooltip explains why. */}
              <Button
                variant="brand"
                size="sm"
                aria-disabled="true"
                aria-describedby="invoice-create-blocked"
                className="cursor-not-allowed opacity-50"
                onClick={(e) => e.preventDefault()}
              >
                <FileText /> Create invoice
              </Button>
            </TooltipTrigger>
            <TooltipContent>{check.reason}</TooltipContent>
          </Tooltip>
        )
      ) : null}
      {canCreate && !check.allowed ? (
        <p id="invoice-create-blocked" className="text-xs text-muted-foreground">{check.reason}</p>
      ) : null}
    </div>
  );
}

/**
 * One invoice, edited in place — the job's (`deal` given: its items, tax and
 * discount are the job's, edited on the job) or a client's on its own page
 * (no `deal`: it owns its lines, tax and discount).
 */
export function InvoiceDetail({
  deal,
  invoice,
  canEditItems,
  onDeleted,
}: {
  deal?: Deal;
  invoice: InvoiceView;
  canEditItems: boolean;
  /** Where to go once the invoice is deleted (a client invoice's page has nothing left to show). */
  onDeleted?: () => void;
}) {
  const { can } = usePermissions();
  const canEdit = can("invoices", "edit");
  const canSend = can("invoices", "send");
  const canDelete = can("invoices", "delete");
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
  const canText = canSend && can("messages", "send");
  const custom = invoice.paymentTerms === PaymentTerms.CUSTOM;
  // One ledger query for the page: the summary panel and the payments section
  // read the same cache entry.
  const ledger = useInvoicePayments(invoice.id, can("payments"));
  const paymentSummary = ledger.data?.summary ?? invoice.paymentSummary;
  const paidTotals = paymentSummary
    ? applyAmountPaid(invoice.totals, paymentSummary.settled)
    : invoice.totals;

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
  const billTo = c?.billingAddress ?? c?.addresses?.[0];
  const pill = "h-9 rounded-pill border-foreground/60 px-4 font-semibold";

  return (
    <div className="space-y-4">
      {/* Workiz invoice header: Client / Bill to on the left, ID · Created · Sent on the right, Actions ▾ and Send above. */}
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-3">
            <h2 className="text-lg font-semibold">
              Invoice #{invoice.number}
              {c ? <span className="font-normal text-muted-foreground"> · {contactName(c)}</span> : null}
            </h2>
            <div className="text-sm">
              <p className="font-semibold">Bill to:</p>
              <p className="text-muted-foreground">{c ? contactName(c) : "—"}</p>
              {billTo ? <p className="text-muted-foreground">{formatAddress(billTo)}</p> : null}
              {c?.phones?.[0] ? <p className="text-muted-foreground">{formatPhone(c.phones[0])}</p> : null}
              {c?.emails?.[0] ? <p className="text-muted-foreground">{c.emails[0]}</p> : null}
            </div>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap items-center justify-end gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="lg" className={pill}>
                    <ChevronDown /> Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  <DropdownMenuItem onSelect={() => setPreviewing(true)}>
                    <Eye /> Preview
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => pdf.open()} disabled={pdf.pending}>
                    <Download /> Download PDF
                  </DropdownMenuItem>
                  {canSend ? (
                    <DropdownMenuItem
                      disabled={markSent.isPending}
                      onSelect={() => markSent.mutate({ id: invoice.id, sent: !invoice.sentAt })}
                    >
                      {invoice.sentAt ? <Undo2 /> : <Send />} {invoice.sentAt ? "Mark as unsent" : "Mark as sent"}
                    </DropdownMenuItem>
                  ) : null}
                  {canSend ? (
                    <DropdownMenuItem disabled={portalLink.disabled} onSelect={() => void portalLink.copy()}>
                      {portalLink.pending ? <Loader2 className="animate-spin" /> : <Link2 />} Copy client portal link
                    </DropdownMenuItem>
                  ) : null}
                  {canDelete ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(true)}>
                        <Trash2 /> Delete invoice
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
              {canText ? (
                <Button variant="default" size="lg" className="h-9 rounded-pill px-5 font-semibold" onClick={() => setSendingVia("email")}>
                  <Send /> Send
                </Button>
              ) : canSend ? (
                <CopyPortalLinkButton contactId={invoice.contactId} />
              ) : null}
            </div>
            <dl className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-sm">
              <dt className="text-right font-semibold">Invoice ID:</dt>
              <dd className="font-mono tabular-nums">{invoice.number}</dd>
              <dt className="text-right font-semibold">Created:</dt>
              <dd>{formatYmd(invoice.createdAt)}</dd>
              <dt className="text-right font-semibold">Sent:</dt>
              <dd className={invoice.sentAt ? "text-success-text" : "text-destructive"}>
                {invoice.sentAt ? formatYmd(invoice.sentAt) : "No"}
              </dd>
              <dt className="text-right font-semibold">Status:</dt>
              <dd className="flex flex-wrap items-center gap-1.5">
                <InvoiceStatusBadge status={invoice.status} />
                {isPartiallyPaid(paymentSummary?.settled ?? 0, paidTotals.balanceDue) ? <PartiallyPaidBadge /> : null}
                {invoice.signedAt ? (
                  <Badge variant="outline">Signed</Badge>
                ) : invoice.requestSignature ? (
                  <Badge variant="outline">Signature requested</Badge>
                ) : null}
              </dd>
            </dl>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <DocField label="Invoice date" htmlFor="invoice-date">
            <CommitInput
              id="invoice-date"
              type="date"
              value={invoice.invoiceDate}
              disabled={!canEdit}
              onCommit={(invoiceDate) => {
                if (!invoiceDate) return;
                const dueDate = dueDateForTerms(invoiceDate, invoice.paymentTerms, invoice.dueDate);
                save(dueDate !== invoice.dueDate ? { invoiceDate, dueDate } : { invoiceDate });
              }}
            />
          </DocField>
          <DocField label="Payment terms" htmlFor="invoice-terms">
            <Select
              value={invoice.paymentTerms}
              disabled={!canEdit}
              onValueChange={(v) => {
                const paymentTerms = v as PaymentTerms;
                const dueDate = dueDateForTerms(invoice.invoiceDate, paymentTerms, invoice.dueDate);
                save({ paymentTerms, dueDate });
              }}
            >
              <SelectTrigger id="invoice-terms" size="sm" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {PAYMENT_TERMS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </DocField>
          <DocField label="Due date" htmlFor="invoice-due">
            <CommitInput
              id="invoice-due"
              type="date"
              value={invoice.dueDate}
              min={invoice.invoiceDate}
              disabled={!canEdit || !custom}
              title={custom ? undefined : "Set by the payment terms — pick Custom to choose a date"}
              onCommit={(dueDate) => dueDate && save({ dueDate })}
            />
          </DocField>
          <DocField label="Template" htmlFor="invoice-template">
            <DocumentTemplateSelect
              id="invoice-template"
              kind="invoice"
              value={invoice.templateId}
              disabled={!canEdit}
              onChange={(templateId) => update.mutate({ templateId })}
            />
          </DocField>
        </div>

      </section>

      {deal ? (
        <DealProductsTab
          deal={deal}
          canEdit={canEditItems}
          showPayments
          paymentSummary={paymentSummary}
        />
      ) : (
        <>
          <InvoiceItemsTable invoiceId={invoice.id} items={invoice.items} canEdit={canEditItems} />
          <div className="flex justify-end">
            <DocumentSummaryPanel
              totals={paidTotals}
              taxRateId={invoice.taxRateId}
              taxRateName={invoice.taxRateName}
              taxSource={invoice.taxSource}
              discount={invoice.discount}
              canEdit={canEdit}
              pending={update.isPending && (update.variables?.taxRateId !== undefined || update.variables?.discount !== undefined)}
              onTaxChange={(taxRateId) => update.mutate({ taxRateId })}
              onDiscountChange={(discount) => update.mutate({ discount })}
              showPayments
              paymentSummary={paymentSummary}
            />
          </div>
        </>
      )}

      <InvoicePaymentsSection invoice={invoice} dealId={deal?.id} />

      <div id="invoice-signatures">
      <SignaturesSection
        signatures={invoice.signatures ?? []}
        signerName={[client.data?.firstName, client.data?.lastName].filter(Boolean).join(" ")}
        canSign={canEdit}
        saving={sign.isPending}
        onSign={(input) => sign.mutateAsync(input)}
      />
      </div>

      <DocField label="Invoice notes" htmlFor="invoice-notes">
        <CommitTextarea
          id="invoice-notes"
          rows={3}
          maxLength={5000}
          placeholder="Shown on the invoice (payment instructions, thank-you note…)"
          value={invoice.notes ?? ""}
          disabled={!canEdit}
          onCommit={(notes) => save({ notes })}
        />
      </DocField>

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
