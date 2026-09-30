"use client";

import { useMemo, useState } from "react";
import { FileText, Loader2, Plus, Receipt, Undo2 } from "lucide-react";
import type { Deal, Payment } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getApiErrorMessage } from "@/lib/api/errors";
import { toneClasses } from "@/lib/theme/tone";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUserMap } from "@/features/deals/hooks";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { useDealPayments, useResendReceipt } from "../hooks";
import { CLEARING_NOTE, PAYMENT_METHOD_META, canRefund, isPartiallyPaid, paymentMethodLabel } from "../lib";
import { PartiallyPaidBadge, PaymentStatusBadge } from "./payment-status-badge";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { RefundPaymentDialog } from "./refund-payment-dialog";

/** The Payments tab's label under the name, as Workiz shows it: "$0.00 balance". */
export function paymentsTabCaption(balanceDue: number | undefined): string | null {
  return typeof balanceDue === "number" ? `${formatMoney(balanceDue)} balance` : null;
}

/**
 * The job's Payments tab (Workiz). A payment belongs to the JOB — an invoice
 * is a separate document made only by "Create invoice" — so this works on a
 * job that was never invoiced: the ledger, the balance against the job's
 * total, and "Add payment" for money taken offline.
 */
export function DealPaymentsTab({
  deal,
  onCreateInvoice,
}: {
  deal: Pick<Deal, "id">;
  /** Shown as "Create invoice" when set — the page passes it only while there is none to open. */
  onCreateInvoice?: () => void;
}) {
  const { can } = usePermissions();
  const canView = can("payments");
  const canCollect = can("payments", "collect");
  const canGiveBack = can("payments", "refund");
  const ledger = useDealPayments(deal.id, canView);
  const resend = useResendReceipt();
  const [recording, setRecording] = useState(false);
  const [refunding, setRefunding] = useState<Payment | null>(null);

  const rows = useMemo(() => ledger.data?.payments ?? [], [ledger.data]);
  const collectors = useMemo(
    () => rows.map((p) => p.takenBy).filter((id) => id && id !== "client"),
    [rows],
  );
  const { map: users } = useUserMap(collectors);

  if (!canView) return null;

  if (ledger.isLoading) return <Skeleton className="h-40 w-full" />;
  if (ledger.isError || !ledger.data) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
        <p>{getApiErrorMessage(ledger.error, "Couldn't load the payments")}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => ledger.refetch()}>
          Try again
        </Button>
      </div>
    );
  }

  const { summary, total, amountPaid, balanceDue } = ledger.data;
  const collectedBy = (id: string) => {
    if (id === "client") return "Client (portal)";
    const u = users.get(id);
    const name = u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
    return name || "—";
  };

  return (
    <section aria-labelledby="deal-payments-heading" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="deal-payments-heading" className="text-base font-semibold">
          Payments
        </h2>
        {isPartiallyPaid(amountPaid, balanceDue) ? <PartiallyPaidBadge /> : null}
        <span className="flex-1" />
        {onCreateInvoice ? (
          <Button variant="outline" size="sm" onClick={onCreateInvoice}>
            <FileText /> Create invoice
          </Button>
        ) : null}
        {canCollect ? (
          <Button variant="brand" size="sm" onClick={() => setRecording(true)}>
            <Plus /> Add payment
          </Button>
        ) : null}
      </div>

      <dl className="grid grid-cols-3 divide-x rounded-lg border text-sm">
        <div className="px-3 py-2">
          <dt className="text-xs text-muted-foreground">Job total</dt>
          <dd className="font-mono tabular-nums">{formatMoney(total)}</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="text-xs text-muted-foreground">Paid</dt>
          <dd className="font-mono tabular-nums">{formatMoney(amountPaid)}</dd>
        </div>
        <div className="px-3 py-2">
          <dt className="text-xs text-muted-foreground">Balance</dt>
          <dd className="font-mono font-semibold tabular-nums" data-testid="deal-payments-balance">
            {formatMoney(balanceDue)}
          </dd>
        </div>
      </dl>

      {summary.hasPending ? (
        <p className={`rounded-md border px-3 py-2 text-sm ${toneClasses("warning")}`}>
          <span className="font-medium tabular-nums">{formatMoney(summary.pending)} clearing</span> —{" "}
          {CLEARING_NOTE} It comes off the balance once it lands.
        </p>
      ) : null}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No payments on this job yet.
        </p>
      ) : (
        <div className="overflow-x-auto border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Tip</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Collected by</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => {
                const Icon = PAYMENT_METHOD_META[p.method]?.icon ?? Receipt;
                const what = `the ${formatMoney(p.amount)} ${paymentMethodLabel(p.method).toLowerCase()} payment`;
                const receiptable = p.status === "settled" || p.status === "refunded";
                const resending = resend.isPending && resend.variables === p.id;
                return (
                  <TableRow key={p.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                      {formatYmd(p.takenAt)}
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                        {paymentMethodLabel(p.method)}
                        {p.last4 ? (
                          <span className="text-muted-foreground">
                            ·{p.cardBrand ? ` ${p.cardBrand}` : ""} ••••{p.last4}
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatMoney(p.amount)}
                      {(p.refundedAmount ?? 0) > 0 ? (
                        <span className="block text-[11px] font-normal text-muted-foreground">
                          −{formatMoney(p.refundedAmount)} refunded
                        </span>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                      {p.tipAmount ? formatMoney(p.tipAmount) : "—"}
                    </TableCell>
                    <TableCell className="max-w-40 truncate text-muted-foreground">
                      {p.reference || p.note || "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{collectedBy(p.takenBy)}</TableCell>
                    <TableCell>
                      <PaymentStatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {canCollect && receiptable ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Resend receipt"
                          aria-label={`Resend receipt for ${what}`}
                          disabled={resending}
                          onClick={() => resend.mutate(p.id)}
                        >
                          {resending ? <Loader2 className="animate-spin" /> : <Receipt />}
                        </Button>
                      ) : null}
                      {canGiveBack && canRefund(p) ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          title="Refund"
                          aria-label={`Refund ${what}`}
                          onClick={() => setRefunding(p)}
                        >
                          <Undo2 />
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {canCollect ? (
        <RecordPaymentDialog
          invoiceId={deal.id}
          dealId={deal.id}
          balanceDue={balanceDue}
          target="job"
          open={recording}
          onOpenChange={setRecording}
        />
      ) : null}

      {canGiveBack && refunding ? (
        <RefundPaymentDialog
          payment={refunding}
          invoiceId={refunding.invoiceId}
          dealId={deal.id}
          open
          onOpenChange={(o) => !o && setRefunding(null)}
        />
      ) : null}
    </section>
  );
}
