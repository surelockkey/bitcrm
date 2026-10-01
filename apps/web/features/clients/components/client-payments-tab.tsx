"use client";

import { useState } from "react";
import Link from "next/link";
import type { Deal, Payment } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/features/deals/lib";
import { PaymentStatusBadge } from "@/features/payments/components/payment-status-badge";
import { paymentMethodLabel } from "@/features/payments/lib";
import { paginate } from "@/features/reports/lib";
import { ClientPagination } from "./client-pagination";

/** Workiz's Payments tab: Job, Date, Amount, Type, Status — newest first. The card fetches the rows. */
export function ClientPaymentsTab({
  rows,
  dealsById,
  isLoading,
  isError,
  complete,
}: {
  rows: Payment[];
  dealsById: Map<string, Deal>;
  isLoading: boolean;
  isError: boolean;
  /** Every payment of the client is in hand, so the page count is final. */
  complete: boolean;
}) {
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const paged = paginate(rows, page, size);

  if (isLoading) return <Skeleton className="m-4 h-40" />;
  if (isError) return <p className="p-6 text-sm text-destructive">Couldn&apos;t load the payments.</p>;
  if (rows.length === 0) return <p className="p-6 text-sm text-muted-foreground">No payments yet.</p>;

  return (
    <div className="flex flex-col gap-3 p-4">
      <div className="border-y">
        <Table aria-label="Payments">
          <TableHeader>
            <TableRow>
              <TableHead>Job</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Tip</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paged.rows.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/deals/${p.dealId}`} className="font-mono font-medium text-brand hover:underline">
                    {dealsById.get(p.dealId)?.dealNumber ?? p.dealId.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{formatWhen(p.takenAt)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(p.amount)}</TableCell>
                <TableCell className="text-right tabular-nums">{p.tipAmount ? formatMoney(p.tipAmount) : "—"}</TableCell>
                <TableCell>{paymentMethodLabel(p.method)}</TableCell>
                <TableCell>
                  <PaymentStatusBadge status={p.status} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <ClientPagination page={paged.page} pages={paged.pages} total={paged.total} size={size} onPage={setPage} onSize={(n) => { setSize(n); setPage(1); }} />
      {!complete ? <p className="px-1 text-xs text-muted-foreground">Still counting the client&apos;s payments…</p> : null}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}
