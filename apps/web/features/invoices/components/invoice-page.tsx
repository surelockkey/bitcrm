"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { usePageHistoryLabel } from "@/components/shell/page-history";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { usePageReady } from "@/lib/use-page-ready";
import { useInvoice } from "../hooks";
import { useInvoiceViewData } from "../invoice-view-data";
import { InvoiceDetail } from "./invoice-detail";

/**
 * `/invoices/[id]` — a CLIENT invoice (Workiz: one made from the client card,
 * with no job) on a page of its own, as Workiz's invoice page without a job
 * (pg_invoice_wz_04_nojob): the grey header straight under the breadcrumb
 * ("INVOICE (1140)"), edge to edge. A job's invoice has its home in the
 * job's Invoice tab, so this page sends it there.
 */
export function StandaloneInvoicePage({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const { data: invoice, isError, error } = useInvoice(invoiceId);
  const dealId = invoice?.dealId;
  // A job's invoice only passes through on its way to the job: nothing more
  // is asked for it here. A client's comes up whole — its client, payments
  // and pickers with it.
  const own = invoice === undefined ? undefined : dealId ? null : invoice;
  const { allIn } = useInvoiceViewData({ invoice: own, canEditItems: can("invoices", "edit") });
  const ready = usePageReady(!permsLoading && allIn);
  usePageHistoryLabel(own ? `Invoice (${own.number})` : undefined);

  useEffect(() => {
    if (dealId) router.replace(`/deals/${dealId}?tab=invoice`);
  }, [dealId, router]);

  if (dealId || (!ready && !isError)) {
    return (
      <div className="p-6">
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (isError || !invoice) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          {getApiErrorMessage(error, "This invoice couldn't be loaded — it may have been deleted.")}
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <InvoiceDetail
        edge
        invoice={invoice}
        canEditItems={can("invoices", "edit")}
        onDeleted={() => router.push(`/contacts/${invoice.contactId}`)}
      />
    </div>
  );
}
