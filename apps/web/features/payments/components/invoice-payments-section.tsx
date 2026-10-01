"use client";

import { useState } from "react";
import { Loader2, Plus, Receipt, Undo2 } from "lucide-react";
import { EMPTY_PAYMENT_SUMMARY, type InvoiceView, type Payment } from "@bitcrm/types";
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
import { usePermissions } from "@/features/auth/use-permissions";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { useInvoicePayments, useResendReceipt } from "../hooks";
import {
  CLEARING_NOTE,
  PAYMENT_METHOD_META,
  applyAmountPaid,
  canRefund,
  isPartiallyPaid,
  paymentMethodLabel,
} from "../lib";
import { PartiallyPaidBadge, PaymentStatusBadge } from "./payment-status-badge";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { RefundPaymentDialog } from "./refund-payment-dialog";
import { toneClasses } from "@/lib/theme/tone";

/**
 * The invoice's payment ledger, under its items and totals: what came in, how,
 * and what is still clearing. A part-paid invoice keeps its `due`/`overdue`
 * status (Workiz does the same) — the badge here is what says so.
 */
export function InvoicePaymentsSection({
  invoice,
  dealId,
}: {
  invoice: InvoiceView;
  dealId?: string;
}) {
  const { can } = usePermissions();
  const canView = can("payments");
  // The ledger is keyed by the job: a client invoice (no job) can be read but not paid yet.
  const canCollect = can("payments", "collect") && !!invoice.dealId;
  const canGiveBack = can("payments", "refund");
  const ledger = useInvoicePayments(invoice.id, canView);
  const resend = useResendReceipt();
  const [recording, setRecording] = useState(false);
  const [refunding, setRefunding] = useState<Payment | null>(null);

  if (!canView) return null;

  const summary = ledger.data?.summary ?? invoice.paymentSummary ?? EMPTY_PAYMENT_SUMMARY;
  const totals = applyAmountPaid(invoice.totals, summary.settled);
  const rows = ledger.data?.payments ?? [];

  return (
    <section aria-labelledby="invoice-payments-heading" className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="invoice-payments-heading" className="text-base font-semibold">
          Payments
        </h3>
        {isPartiallyPaid(summary.settled, totals.balanceDue) ? <PartiallyPaidBadge /> : null}
        <span className="text-xs text-muted-foreground">
          {formatMoney(summary.settled)} collected · {formatMoney(totals.balanceDue)} due
        </span>
        {canCollect ? (
          <Button variant="brand" size="sm" className="ml-auto" onClick={() => setRecording(true)}>
            <Plus /> Record payment
          </Button>
        ) : null}
      </div>

      {summary.hasPending ? (
        <p className={`rounded-md border px-3 py-2 text-sm ${toneClasses("warning")}`}>
          <span className="font-medium tabular-nums">{formatMoney(summary.pending)} clearing</span> —{" "}
          {CLEARING_NOTE} It comes off the balance once it lands.
        </p>
      ) : null}

      {ledger.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : ledger.isError ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          <p>{getApiErrorMessage(ledger.error, "Couldn't load the payments")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => ledger.refetch()}>
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No payments on this invoice yet.
        </p>
      ) : (
        <div className="overflow-x-auto border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Date</TableHead>
                <TableHead>Method</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <PaymentRow
                  key={p.id}
                  payment={p}
                  canCollect={canCollect}
                  canGiveBack={canGiveBack}
                  resending={resend.isPending && resend.variables === p.id}
                  onResend={() => resend.mutate(p.id)}
                  onRefund={() => setRefunding(p)}
                />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {canCollect ? (
        <RecordPaymentDialog
          invoiceId={invoice.id}
          dealId={dealId}
          balanceDue={totals.balanceDue}
          open={recording}
          onOpenChange={setRecording}
        />
      ) : null}

      {canGiveBack && refunding ? (
        <RefundPaymentDialog
          payment={refunding}
          invoiceId={invoice.id}
          dealId={dealId}
          open
          onOpenChange={(o) => !o && setRefunding(null)}
        />
      ) : null}
    </section>
  );
}

function PaymentRow({
  payment,
  canCollect,
  canGiveBack,
  resending,
  onResend,
  onRefund,
}: {
  payment: Payment;
  canCollect: boolean;
  canGiveBack: boolean;
  resending: boolean;
  onResend: () => void;
  onRefund: () => void;
}) {
  const Icon = PAYMENT_METHOD_META[payment.method]?.icon ?? Receipt;
  const what = `the ${formatMoney(payment.amount)} ${paymentMethodLabel(payment.method).toLowerCase()} payment`;
  // A receipt only means something once the money is the client's problem no more.
  const receiptable = payment.status === "settled" || payment.status === "refunded";

  return (
    <TableRow>
      <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
        {formatYmd(payment.takenAt)}
      </TableCell>
      <TableCell>
        <span className="flex items-center gap-1.5">
          <Icon className="size-3.5 text-muted-foreground" aria-hidden />
          {paymentMethodLabel(payment.method)}
          {payment.last4 ? (
            <span className="text-muted-foreground">
              ·{payment.cardBrand ? ` ${payment.cardBrand}` : ""} ••••{payment.last4}
            </span>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="max-w-40 truncate text-muted-foreground">
        {payment.reference || payment.note || "—"}
      </TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {formatMoney(payment.amount)}
        {payment.refundedAmount > 0 ? (
          <span className="block text-[11px] font-normal text-muted-foreground">
            −{formatMoney(payment.refundedAmount)} refunded
          </span>
        ) : null}
      </TableCell>
      <TableCell>
        <PaymentStatusBadge status={payment.status} />
        {payment.failureReason ? (
          <span className="block text-[11px] text-muted-foreground">{payment.failureReason}</span>
        ) : null}
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
            onClick={onResend}
          >
            {resending ? <Loader2 className="animate-spin" /> : <Receipt />}
          </Button>
        ) : null}
        {canGiveBack && canRefund(payment) ? (
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Refund"
            aria-label={`Refund ${what}`}
            onClick={onRefund}
          >
            <Undo2 />
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  );
}
