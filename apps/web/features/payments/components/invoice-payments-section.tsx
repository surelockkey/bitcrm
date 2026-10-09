"use client";

import { useState } from "react";
import { Loader2, MoreVertical, Plus, Receipt, ReceiptText, Undo2 } from "lucide-react";
import { EMPTY_PAYMENT_SUMMARY, type InvoiceView, type Payment } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WZ_MENU_POPUP, WZ_MENU_POPUP_ITEM } from "@/components/workiz/menu-popup";
import { cn } from "@/lib/utils";
import { PaymentsArt } from "@/features/deals/components/job-empty-art";
import { workizDateTime } from "@/features/deals/job-shell";
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
  PAYMENT_STATUS_META,
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
  variant = "card",
}: {
  invoice: InvoiceView;
  dealId?: string;
  /**
   * `card` (default): the bordered card as it was. `workiz`: Workiz's
   * Payments on its invoice page (pg_invoice_wz_01_partial / _03_due) — the
   * same ledger, rights and dialogs in its dress.
   */
  variant?: "card" | "workiz";
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

  const dialogs = (
    <>
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
    </>
  );

  if (variant === "workiz") {
    return (
      <WorkizPayments
        rows={rows}
        summary={summary}
        ledger={ledger}
        canCollect={canCollect}
        canGiveBack={canGiveBack}
        resend={resend}
        onRecord={() => setRecording(true)}
        onRefund={setRefunding}
      >
        {dialogs}
      </WorkizPayments>
    );
  }

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

      {dialogs}
    </section>
  );
}

/*
 * Workiz's `payments-module` (pg_invoice_wz_01_partial): an h4 with its glyph,
 * 18px/22px 600 #3b4c53 over a #ccc rule 15px under, "Add payment" yellow at
 * the right; 20px down the table — Type 144 · Amount 109 · Date 199 · status
 * 118 · ⋮ 89 of 660, heads 14px bold 15px 18px between #ccc rules, cells
 * 13px/16px 20px 10px 20px 20px over #e6e6e6 / #ddd, the status a white Tag
 * (r4, 4px); none yet → the picture and "+ Add payments" (_03_due).
 */
const WZ_TH = "h-[47px] border-y border-input px-[18px] py-[15px] text-left text-[14px] leading-4 font-bold capitalize";
const WZ_TD = "border-t border-b border-t-[#e6e6e6] border-b-[#dddddd] py-5 pr-2.5 pl-5 align-top text-[13px] leading-4";
/** Workiz's Tag-module colours: success green, warning orange, danger red, the grey for money given back. */
const WZ_TAG: Record<Payment["status"], string> = {
  settled: "bg-wz-tag-success",
  pending: "bg-[#f5ad0b]",
  failed: "bg-wz-error",
  reversed: "bg-wz-error",
  refunded: "bg-wz-outline",
};

function WorkizPayments({
  rows,
  summary,
  ledger,
  canCollect,
  canGiveBack,
  resend,
  onRecord,
  onRefund,
  children,
}: {
  rows: Payment[];
  summary: { pending: number; hasPending: boolean };
  ledger: ReturnType<typeof useInvoicePayments>;
  canCollect: boolean;
  canGiveBack: boolean;
  resend: ReturnType<typeof useResendReceipt>;
  onRecord: () => void;
  onRefund: (p: Payment) => void;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby="invoice-payments-heading" className="text-wz-strong">
      <div className="flex min-h-[48px] items-start justify-between gap-3 border-b border-input pb-[15px]">
        <h3 id="invoice-payments-heading" className="flex items-center gap-2 pt-[5px] text-[18px] leading-[22px] font-semibold text-[#3b4c53]">
          <ReceiptText className="size-5" strokeWidth={1.25} aria-hidden />
          Payments
        </h3>
        {canCollect ? (
          <WzButton size="regular" onClick={onRecord}>
            Add payment
          </WzButton>
        ) : null}
      </div>

      {summary.hasPending ? (
        <p className="mt-3 text-[13px] leading-4 text-wz-text">
          <span className="font-semibold tabular-nums">{formatMoney(summary.pending)} clearing</span> — {CLEARING_NOTE} It comes off
          the balance once it lands.
        </p>
      ) : null}

      {ledger.isLoading ? (
        <Skeleton className="mt-5 h-24 w-full" />
      ) : ledger.isError ? (
        <div className="mt-5 p-6 text-center text-[13px]">
          <p>{getApiErrorMessage(ledger.error, "Couldn't load the payments")}</p>
          <WzButton variant="secondary" size="regular" className="mt-3" onClick={() => ledger.refetch()}>
            Try again
          </WzButton>
        </div>
      ) : rows.length === 0 ? (
        // pg_invoice_wz_03_due: the picture, then the tertiary "+ Add payments".
        <div className="flex flex-col items-center gap-2.5 pt-[69px] pb-6">
          <PaymentsArt />
          {canCollect ? (
            <WzButton variant="tertiary" size="regular" icon={<Plus strokeWidth={1.5} />} onClick={onRecord}>
              Add payments
            </WzButton>
          ) : (
            <p className="text-[13px] leading-4">No payments on this invoice yet.</p>
          )}
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[32rem] table-fixed border-separate border-spacing-0 border-b border-input">
            <thead>
              <tr>
                <th className={cn(WZ_TH, "w-[21.8%]")}>Type</th>
                <th className={cn(WZ_TH, "w-[16.5%]")}>Amount</th>
                <th className={cn(WZ_TH, "w-[30.2%]")}>Date</th>
                {/* Workiz writes this one in lower case. */}
                <th className={cn(WZ_TH, "w-[17.9%] normal-case")}>status</th>
                <th className={cn(WZ_TH, "w-[13.6%]")} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const what = `the ${formatMoney(p.amount)} ${paymentMethodLabel(p.method).toLowerCase()} payment`;
                const receiptable = p.status === "settled" || p.status === "refunded";
                const canResend = canCollect && receiptable;
                const canGiveBackThis = canGiveBack && canRefund(p);
                const resending = resend.isPending && resend.variables === p.id;
                return (
                  <tr key={p.id}>
                    <td className={WZ_TD} title={p.reference || p.note || undefined}>
                      {paymentMethodLabel(p.method)}
                      {p.last4 ? (
                        <span className="block text-wz-text">
                          {p.cardBrand ? `${p.cardBrand} ` : ""}••••{p.last4}
                        </span>
                      ) : null}
                    </td>
                    <td className={cn(WZ_TD, "tabular-nums")}>
                      {formatMoney(p.amount)}
                      {p.refundedAmount > 0 ? (
                        <span className="block text-[12px] text-wz-text">−{formatMoney(p.refundedAmount)} refunded</span>
                      ) : null}
                    </td>
                    <td className={WZ_TD}>{workizDateTime(p.takenAt) || formatYmd(p.takenAt)}</td>
                    <td className={cn(WZ_TD, "pl-2.5")}>
                      <span className={cn("inline-flex rounded-[4px] px-1 py-1.5 text-[13px] leading-4 text-white", WZ_TAG[p.status] ?? "bg-wz-outline")}>
                        {PAYMENT_STATUS_META[p.status]?.label ?? p.status}
                      </span>
                      {p.failureReason ? <span className="mt-1 block text-[11px] text-wz-text">{p.failureReason}</span> : null}
                    </td>
                    <td className={cn(WZ_TD, "text-center")}>
                      {canResend || canGiveBackThis ? (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`Actions for ${what}`}
                              className="-mt-2 inline-grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-wz-secondary-hover"
                            >
                              <MoreVertical className="size-6" strokeWidth={1.5} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" sideOffset={8} alignOffset={-4} className={WZ_MENU_POPUP}>
                            {canResend ? (
                              <DropdownMenuItem
                                className={WZ_MENU_POPUP_ITEM}
                                disabled={resending}
                                onSelect={() => resend.mutate(p.id)}
                              >
                                {resending ? <Loader2 className="animate-spin" /> : <Receipt strokeWidth={1.25} />} Resend receipt
                              </DropdownMenuItem>
                            ) : null}
                            {canGiveBackThis ? (
                              <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={() => onRefund(p)}>
                                <Undo2 strokeWidth={1.25} /> Refund
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {children}
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
