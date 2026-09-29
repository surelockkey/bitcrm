"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CreditCard, ExternalLink, Loader2, X } from "lucide-react";
import { PAYMENT_METHODS, PAYMENT_STATUSES, type Payment } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/api/errors";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContactsByIds } from "@/features/clients/hooks";
import { contactName } from "@/features/clients/lib";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { NoAccess, StatTile } from "@/features/billing/components/list-bits";
import { usePaymentList } from "../hooks";
import {
  PAYMENT_METHOD_META,
  paymentMethodLabel,
  paymentStatusLabel,
  type PaymentMethodFilter,
  type PaymentStatusFilter,
} from "../lib";
import { PaymentStatusBadge } from "./payment-status-badge";

const PAGE_SIZE = 50;

/** Every payment the workspace has taken, filterable, with a way back to the job. */
export function PaymentsPage() {
  const { can } = usePermissions();
  const canView = can("payments");
  const [method, setMethod] = useState<PaymentMethodFilter>("all");
  const [status, setStatus] = useState<PaymentStatusFilter>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const params = useMemo(
    () => ({
      method: method === "all" ? undefined : method,
      status: status === "all" ? undefined : status,
      from: from || undefined,
      to: to || undefined,
      limit: PAGE_SIZE,
    }),
    [method, status, from, to],
  );

  const q = usePaymentList(params, canView);
  const rows: Payment[] = useMemo(() => q.data?.pages.flatMap((p) => p.items) ?? [], [q.data]);
  const summary = q.data?.pages[0]?.summary;

  if (!canView) return <NoAccess what="payments" />;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b px-6 py-3">
        <h1 className="text-lg font-semibold tracking-tight">Payments</h1>
      </div>

      <div className="flex-1 space-y-4 overflow-auto p-4 sm:p-6">
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <StatTile
            label="Collected"
            loading={q.isLoading}
            value={formatMoney(summary?.settled ?? 0)}
            hint={summary ? `${summary.paymentCount} payment${summary.paymentCount === 1 ? "" : "s"}` : undefined}
          />
          <StatTile
            label="Clearing"
            tone="amber"
            loading={q.isLoading}
            value={formatMoney(summary?.pending ?? 0)}
            hint="Bank payments in transit"
          />
          <StatTile
            label="Refunded"
            tone="red"
            loading={q.isLoading}
            value={formatMoney(summary?.refunded ?? 0)}
            hint="Given back to clients"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethodFilter)}>
            <SelectTrigger size="sm" aria-label="Method" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              {PAYMENT_METHODS.map((m) => (
                <SelectItem key={m} value={m}>
                  {paymentMethodLabel(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={(v) => setStatus(v as PaymentStatusFilter)}>
            <SelectTrigger size="sm" aria-label="Status" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {PAYMENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {paymentStatusLabel(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap items-center gap-1.5 sm:ml-auto">
            <Label htmlFor="pay-from" className="text-xs text-muted-foreground">From</Label>
            <Input
              id="pay-from"
              type="date"
              className="h-8 w-36"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
            <Label htmlFor="pay-to" className="text-xs text-muted-foreground">To</Label>
            <Input
              id="pay-to"
              type="date"
              className="h-8 w-36"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
            {from || to ? (
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label="Clear dates"
                onClick={() => {
                  setFrom("");
                  setTo("");
                }}
              >
                <X />
              </Button>
            ) : null}
          </div>
        </div>

        <PaymentsTable query={q} rows={rows} />
      </div>
    </div>
  );
}

function PaymentsTable({
  query: q,
  rows,
}: {
  query: ReturnType<typeof usePaymentList>;
  rows: Payment[];
}) {
  // Only the clients on this page, not the whole book.
  const { map: contacts } = useContactsByIds(rows.map((r) => r.contactId));

  if (q.isLoading) return <Skeleton className="h-64 w-full" />;
  if (q.isError) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(q.error, "Couldn't load payments")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => q.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-12 text-center text-muted-foreground">
        <CreditCard className="size-6" />
        <p className="text-sm">No payments match these filters.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Date</TableHead>
              <TableHead>Client</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Job</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((p) => {
              const c = contacts.get(p.contactId);
              const Icon = PAYMENT_METHOD_META[p.method]?.icon ?? CreditCard;
              return (
                <TableRow key={p.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatYmd(p.takenAt)}
                  </TableCell>
                  <TableCell className="max-w-48 truncate">{c ? contactName(c) : "—"}</TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5">
                      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                      {paymentMethodLabel(p.method)}
                      {p.last4 ? <span className="text-muted-foreground">••••{p.last4}</span> : null}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-40 truncate text-muted-foreground">
                    {p.reference || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">
                    {formatMoney(p.amount)}
                    {p.refundedAmount > 0 ? (
                      <span className="block text-[11px] font-normal text-muted-foreground">
                        −{formatMoney(p.refundedAmount)} refunded
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <PaymentStatusBadge status={p.status} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/deals/${p.dealId}`}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      Job <ExternalLink className="size-3" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {q.hasNextPage ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => q.fetchNextPage()}
            disabled={q.isFetchingNextPage}
          >
            {q.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null} Load more
          </Button>
        </div>
      ) : null}
    </div>
  );
}
