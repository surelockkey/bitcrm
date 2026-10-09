"use client";

import { FileText, Loader2 } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { WzButton } from "@/components/workiz/button";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePageReady } from "@/lib/use-page-ready";
import { usePermissions } from "@/features/auth/use-permissions";
import { useDealProducts } from "@/features/deals/hooks";
import { useCreateInvoice, useInvoiceByDeal } from "../hooks";
import { useInvoiceViewData } from "../invoice-view-data";
import { canCreateInvoice } from "../lib";
import { InvoiceDetail } from "./invoice-detail";

export { InvoiceDetail };

/**
 * The job's Invoice tab: one invoice per job whose items, tax and discount
 * ARE the job's — drawn as Workiz draws its invoice page (InvoiceDetail).
 */
export function DealInvoiceTab({ deal, canEditItems }: { deal: Deal; canEditItems: boolean }) {
  const { can } = usePermissions();
  const { data: invoice, isError, error, refetch } = useInvoiceByDeal(deal.id);
  // The tab comes up whole — the invoice with the job's items, its payments,
  // its schedule, the job's files and its pickers — rather than filling in
  // and pushing its sections down. A new invoice (made from "No invoice yet")
  // is a new first frame.
  const { allIn } = useInvoiceViewData({ invoice, deal, canEditItems });
  const ready = usePageReady(allIn, invoice?.id ?? "none");

  if (isError) {
    return (
      <div className="p-8 text-center text-[14px] text-wz-strong">
        <p>{getApiErrorMessage(error, "Couldn't load the invoice")}</p>
        <WzButton variant="secondary" size="regular" className="mt-3" onClick={() => refetch()}>
          Try again
        </WzButton>
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
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center text-wz-strong">
      <span className="flex size-10 items-center justify-center rounded-[8px] bg-wz-secondary-hover text-wz-text">
        <FileText className="size-5" strokeWidth={1.5} />
      </span>
      <div>
        <h3 className="text-[18px] leading-[22px] font-semibold text-[#3b4c53]">No invoice yet</h3>
        <p className="mt-1 max-w-sm text-[14px] leading-5 text-wz-text">
          The invoice uses this job&apos;s items, tax and discount, and stays in sync with them.
        </p>
      </div>
      {canCreate ? (
        check.allowed ? (
          <WzButton
            size="regular"
            icon={create.isPending ? <Loader2 className="animate-spin" /> : <FileText strokeWidth={1.5} />}
            onClick={() => create.mutate(deal.id)}
            disabled={create.isPending || isLoading}
          >
            Create invoice
          </WzButton>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              {/* aria-disabled keeps it focusable so the tooltip explains why. */}
              <WzButton
                size="regular"
                icon={<FileText strokeWidth={1.5} />}
                aria-disabled="true"
                aria-describedby="invoice-create-blocked"
                className="cursor-not-allowed opacity-50 hover:bg-primary"
                onClick={(e) => e.preventDefault()}
              >
                Create invoice
              </WzButton>
            </TooltipTrigger>
            <TooltipContent>{check.reason}</TooltipContent>
          </Tooltip>
        )
      ) : null}
      {canCreate && !check.allowed ? (
        <p id="invoice-create-blocked" className="text-[12px] text-wz-text">{check.reason}</p>
      ) : null}
    </div>
  );
}
