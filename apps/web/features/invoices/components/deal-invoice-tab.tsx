"use client";

import { useState } from "react";
import { Download, Eye, FileText, Loader2, Send, Trash2, Undo2 } from "lucide-react";
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
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealProducts } from "@/features/deals/hooks";
import { DealProductsTab } from "@/features/deals/components/deal-products-tab";
import { formatYmd } from "@/features/billing/dates";
import { useOpenPdf } from "@/features/billing/open-pdf";
import { CommitInput, CommitTextarea, DocField } from "@/features/billing/components/document-field";
import { DocumentPreviewDialog } from "@/features/billing/components/document-preview-dialog";
import { DocumentSummaryPanel } from "@/features/billing/components/document-summary-panel";
import { DocumentTemplateSelect } from "@/features/billing/components/document-template-select";
import { CopyPortalLinkButton } from "@/features/portal/components/copy-portal-link-button";
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
import { PAYMENT_TERMS_OPTIONS, canCreateInvoice, dueDateForTerms } from "../lib";
import { invoiceEditSchema, type InvoicePatch } from "../schemas";
import { InvoiceItemsTable } from "./invoice-items-table";
import { InvoiceStatusBadge } from "./invoice-status-badge";
import { SentBadge } from "./sent-badge";

/**
 * The job's Invoice tab (Workiz): one invoice per job whose items, tax and
 * discount ARE the job's — so the items table here is the job's own.
 */
export function DealInvoiceTab({ deal, canEditItems }: { deal: Deal; canEditItems: boolean }) {
  const { can } = usePermissions();
  const { data: invoice, isLoading, isError, error, refetch } = useInvoiceByDeal(deal.id);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(error, "Couldn't load the invoice")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => refetch()}>Try again</Button>
      </div>
    );
  }
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

  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-lg border p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Invoice #{invoice.number}</h2>
          <InvoiceStatusBadge status={invoice.status} />
          {isPartiallyPaid(paymentSummary?.settled ?? 0, paidTotals.balanceDue) ? (
            <PartiallyPaidBadge />
          ) : null}
          <SentBadge sentAt={invoice.sentAt} />
          {invoice.signedAt ? (
            <Badge variant="outline">Signed</Badge>
          ) : invoice.requestSignature ? (
            <Badge variant="outline">Signature requested</Badge>
          ) : null}
          <span className="ml-auto text-xs text-muted-foreground">Created {formatYmd(invoice.createdAt)}</span>
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

        <div className="flex flex-wrap gap-1.5 border-t pt-3">
          <Button variant="outline" size="sm" onClick={() => setPreviewing(true)}>
            <Eye /> Preview
          </Button>
          <Button variant="outline" size="sm" onClick={pdf.open} disabled={pdf.pending}>
            {pdf.pending ? <Loader2 className="animate-spin" /> : <Download />} Download PDF
          </Button>
          {canSend ? (
            <Button
              variant="outline"
              size="sm"
              disabled={markSent.isPending}
              onClick={() => markSent.mutate({ id: invoice.id, sent: !invoice.sentAt })}
            >
              {markSent.isPending ? <Loader2 className="animate-spin" /> : invoice.sentAt ? <Undo2 /> : <Send />}
              {invoice.sentAt ? "Mark as unsent" : "Mark as sent"}
            </Button>
          ) : null}
          {canText ? (
            <Button variant="brand" size="sm" onClick={() => setSendingVia("sms")}>
              <Send /> Send
            </Button>
          ) : null}
          {canSend ? <CopyPortalLinkButton contactId={invoice.contactId} /> : null}
          {canDelete ? (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-destructive hover:text-destructive"
              onClick={() => setDeleting(true)}
              aria-label="Delete invoice"
            >
              <Trash2 /> Delete
            </Button>
          ) : null}
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

      <SignaturesSection
        signatures={invoice.signatures ?? []}
        signerName={[client.data?.firstName, client.data?.lastName].filter(Boolean).join(" ")}
        canSign={canEdit}
        saving={sign.isPending}
        onSign={(input) => sign.mutateAsync(input)}
      />

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
