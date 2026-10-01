"use client";

import Link from "next/link";
import { FileSpreadsheet, FileText } from "lucide-react";
import type { ReactNode } from "react";
import type { Estimate, Invoice } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { useEstimatesForContacts } from "@/features/estimates/hooks";
import { EstimateStatusBadge } from "@/features/estimates/components/estimate-status-badge";
import { useInvoicesForContacts } from "@/features/invoices/hooks";
import { InvoiceStatusBadge } from "@/features/invoices/components/invoice-status-badge";
import { SentBadge } from "@/features/invoices/components/sent-badge";

function DocList({
  isLoading,
  isError,
  error,
  empty,
  icon,
  children,
  count,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  empty: string;
  icon: ReactNode;
  children: ReactNode;
  count: number;
}) {
  if (isLoading) return <Skeleton className="h-20 w-full" />;
  if (isError) {
    return <p className="text-xs text-destructive">{getApiErrorMessage(error, "Couldn't load documents")}</p>;
  }
  if (count === 0) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
        {icon} {empty}
      </div>
    );
  }
  return <ul className="divide-y rounded-lg border">{children}</ul>;
}

/** Where a document opens: its job's tab, or — with no job — its own page. */
export const invoiceHref = (inv: Pick<Invoice, "id" | "dealId">): string =>
  inv.dealId ? `/deals/${inv.dealId}?tab=invoice` : `/invoices/${inv.id}`;
export const estimateHref = (e: Pick<Estimate, "id" | "dealId">): string =>
  e.dealId ? `/deals/${e.dealId}?tab=estimates&estimate=${e.id}` : `/estimates/${e.id}`;

/** A client's invoices — their jobs' and their own (no job) — each linking where it lives. */
export function ClientInvoicesList({ contactIds }: { contactIds: string[] }) {
  const q = useInvoicesForContacts(contactIds);
  return (
    <DocList {...q} count={q.data.length} empty="No invoices yet." icon={<FileText className="size-4" />}>
      {q.data.map((inv) => (
        <li key={inv.id}>
          <Link
            href={invoiceHref(inv)}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-accent/40"
          >
            <span className="font-mono font-medium">#{inv.number}</span>
            <InvoiceStatusBadge status={inv.status} />
            <SentBadge sentAt={inv.sentAt} />
            <span className="text-xs text-muted-foreground">Due {formatYmd(inv.dueDate)}</span>
            <span className="ml-auto text-right">
              <span className="font-mono tabular-nums">{formatMoney(inv.totals?.total ?? 0)}</span>
              {inv.totals && inv.totals.balanceDue > 0 && inv.totals.balanceDue !== inv.totals.total ? (
                <span className="block text-[11px] text-muted-foreground">
                  {formatMoney(inv.totals.balanceDue)} due
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </DocList>
  );
}

/** A client's estimates — their jobs' and their own (no job) — each linking where it lives. */
export function ClientEstimatesList({ contactIds }: { contactIds: string[] }) {
  const q = useEstimatesForContacts(contactIds);
  return (
    <DocList {...q} count={q.data.length} empty="No estimates yet." icon={<FileSpreadsheet className="size-4" />}>
      {q.data.map((e) => (
        <li key={e.id}>
          <Link
            href={estimateHref(e)}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-accent/40"
          >
            <span className="font-mono font-medium">#{e.number}</span>
            {e.name ? <span className="max-w-40 truncate">{e.name}</span> : null}
            <EstimateStatusBadge status={e.status} />
            <span className="text-xs text-muted-foreground">{formatYmd(e.estimateDate || e.createdAt)}</span>
            <span className="ml-auto font-mono tabular-nums">{formatMoney(e.totals?.total ?? 0)}</span>
          </Link>
        </li>
      ))}
    </DocList>
  );
}
