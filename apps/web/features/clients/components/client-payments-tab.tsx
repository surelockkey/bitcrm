"use client";

import Link from "next/link";
import type { Deal } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatMoney } from "@/features/deals/lib";
import { usePaymentList } from "@/features/payments/hooks";
import { PaymentStatusBadge } from "@/features/payments/components/payment-status-badge";
import { paymentMethodLabel } from "@/features/payments/lib";

const PAGE = 25;

/** Workiz's Payments tab: Job, Date, Amount, Type, Status — newest first. */
export function ClientPaymentsTab({ contactId, dealsById }: { contactId: string; dealsById: Map<string, Deal> }) {
  const q = usePaymentList({ contactId, limit: PAGE });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  if (q.isLoading) return <Skeleton className="m-4 h-40" />;
  if (q.isError) return <p className="p-6 text-sm text-destructive">Couldn&apos;t load the payments.</p>;
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
            {rows.map((p) => (
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
      {q.hasNextPage ? (
        <div>
          <Button variant="outline" size="sm" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {q.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" });
}
