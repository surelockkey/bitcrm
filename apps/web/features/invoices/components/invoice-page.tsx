"use client";

import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { WzJobBackLink } from "@/components/workiz/job-back-link";
import { usePageHistoryLabel } from "@/components/shell/page-history";
import { getApiErrorMessage } from "@/lib/api/errors";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDeal } from "@/features/deals/hooks";
import { useInvoice, useInvoiceByDeal } from "../hooks";
import { useInvoiceViewData } from "../invoice-view-data";
import { InvoiceDetail } from "./invoice-detail";

/**
 * `/invoices/[id]` — every invoice on a page of its own, as Workiz's
 * `/root/invoice/<serial>/`:
 * - a JOB's (the job page's "View Invoice" / "Create Invoice" lead here):
 *   "← Job ID: …" back to the job first in the grey header, its lines the
 *   job's items, its tax, discount, schedule and files the job's
 *   (pg_invoice_wz_01_partial);
 * - a CLIENT's (no job): the grey header straight under the breadcrumb
 *   (pg_invoice_wz_04_nojob).
 *
 * Shown once, whole: one skeleton until the invoice — a job's read from the
 * job's slot, where its edits land — its job, client, payments, pickers,
 * schedule and files are all in.
 */
export function StandaloneInvoicePage({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const byId = useInvoice(invoiceId);
  const dealId = byId.data?.dealId ?? "";
  const byDeal = useInvoiceByDeal(dealId, !!dealId);
  const job = useDeal(dealId, !!dealId);
  const invoice = dealId ? (byDeal.data ?? byId.data) : byId.data;
  // A job invoice's lines are the job's items: the job's own right edits them.
  const canEditItems = dealId ? can("deals", "edit") : can("invoices", "edit");
  const { allIn } = useInvoiceViewData({ invoice, deal: job.data, canEditItems });
  const jobIn = !dealId || (settled(byDeal) && settled(job));
  const ready = usePageReady(!permsLoading && jobIn && allIn);
  usePageHistoryLabel(invoice ? `Invoice (${invoice.number})` : undefined);

  if (!ready && !byId.isError) {
    return (
      <div className="p-6">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (byId.isError || !invoice) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {getApiErrorMessage(byId.error, "This invoice couldn't be loaded — it may have been deleted.")}
        </div>
      </div>
    );
  }

  if (dealId) {
    const deal = job.data;
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {deal ? (
          <InvoiceDetail
            edge
            deal={deal}
            invoice={invoice}
            canEditItems={canEditItems}
            jobLink={
              // header-module__jobLink → the job's Details (/root/job/XYB3JT/details).
              <WzJobBackLink href={`/deals/${encodeURIComponent(dealId)}`}>Job ID: {deal.dealNumber}</WzJobBackLink>
            }
            onDeleted={() => router.push(`/deals/${encodeURIComponent(dealId)}`)}
          />
        ) : (
          <div className="p-6">
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              This invoice&apos;s job couldn&apos;t be loaded.
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <InvoiceDetail
        edge
        invoice={invoice}
        canEditItems={canEditItems}
        onDeleted={() => router.push(`/contacts/${invoice.contactId}`)}
      />
    </div>
  );
}
