"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FileText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContact } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { useInvoice } from "../hooks";
import { InvoiceDetail } from "./deal-invoice-tab";

/**
 * `/invoices/[id]` — a CLIENT invoice (Workiz: one made from the client card,
 * with no job) on a page of its own. A job's invoice has its home in the
 * job's Invoice tab, so this page sends it there.
 */
export function StandaloneInvoicePage({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const { can } = usePermissions();
  const { data: invoice, isLoading, isError, error } = useInvoice(invoiceId);
  const { data: contact } = useContact(invoice?.contactId ?? "");

  const dealId = invoice?.dealId;
  useEffect(() => {
    if (dealId) router.replace(`/deals/${dealId}?tab=invoice`);
  }, [dealId, router]);

  if (isLoading || dealId) {
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
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3 text-sm text-muted-foreground">
        <FileText className="size-4" />
        <span>
          Invoice for{" "}
          <Link href={`/contacts/${invoice.contactId}`} className="font-medium text-primary hover:underline">
            {contact ? contactName(contact) : "the client"}
          </Link>
        </span>
        <span aria-hidden="true">·</span>
        <span>Not tied to a job</span>
      </div>
      <div className="p-6">
        <InvoiceDetail
          invoice={invoice}
          canEditItems={can("invoices", "edit")}
          onDeleted={() => router.push(`/contacts/${invoice.contactId}`)}
        />
      </div>
    </div>
  );
}
