"use client";

import { useMemo, useState } from "react";
import { FileText, Plus } from "lucide-react";
import type { Deal, Payment } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import { toneClasses } from "@/lib/theme/tone";
import { usePermissions } from "@/features/auth/use-permissions";
import { useUserMap } from "@/features/deals/hooks";
import { workizDateTime } from "@/features/deals/job-shell";
import { PaymentsArt } from "@/features/deals/components/job-empty-art";
import { wzPill } from "@/components/workiz";
import { formatMoney } from "@/features/billing/lib";
import { formatYmd } from "@/features/billing/dates";
import { useDealPayments, useResendReceipt } from "../hooks";
import { CLEARING_NOTE, canDeletePayment, canRefund, isPartiallyPaid, paymentLabel } from "../lib";
import { DeletePaymentDialog } from "./delete-payment-dialog";
import { PaymentRowMenu } from "./payment-row-menu";
import { PartiallyPaidBadge, PaymentStatusBadge } from "./payment-status-badge";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { RefundPaymentDialog } from "./refund-payment-dialog";

/** Workiz's payments table (jobshell_wz_N9YA2L_payments): 47px bold heads between 1px #ccc rules. */
const TH = "h-[47px] border-y border-[#cccccc] px-[18px] py-[15px] text-left text-[14px] leading-4 font-bold capitalize";
const TD = "border-t border-b border-t-[#e6e6e6] border-b-[#dddddd] py-5 pr-2.5 pl-5 align-top";

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
  deal: Pick<Deal, "id"> & Partial<Pick<Deal, "contactId">>;
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
  const [deleting, setDeleting] = useState<Payment | null>(null);

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
    <section aria-labelledby="deal-payments-heading" className="text-[#404040]">
      {/* Workiz: "Balance" 20px/500, then "$0.00" 25.2px over "/$150.00" 16.8px grey. */}
      <div className="pl-5">
        <div className="flex items-center gap-2">
          <h3 className="text-[20px] leading-[25px] font-medium text-[#3e4b51]">Balance</h3>
          {isPartiallyPaid(amountPaid, balanceDue) ? <PartiallyPaidBadge /> : null}
        </div>
        <p className="mt-2.5 flex items-baseline">
          <span data-testid="deal-payments-balance" className="text-[25.2px] leading-[35px] font-medium tabular-nums">
            {formatMoney(balanceDue)}
          </span>
          <span className="text-[16.8px] leading-6 text-[#666666] tabular-nums">
            /<span>{formatMoney(total)}</span>
          </span>
        </p>
      </div>

      <div className="mt-3.5 flex min-h-[53px] flex-wrap items-center gap-2.5 py-2.5">
        <h2 id="deal-payments-heading" className="text-[18px] leading-[22px] font-semibold">
          Job payments
        </h2>
        <span className="flex-1" />
        {onCreateInvoice ? (
          <button type="button" className={wzPill("outline")} onClick={onCreateInvoice}>
            <FileText /> Create invoice
          </button>
        ) : null}
        {canCollect ? (
          <button type="button" className={wzPill("yellow", "small")} onClick={() => setRecording(true)}>
            Add payment
          </button>
        ) : null}
      </div>

      {summary.hasPending ? (
        <p className={`mt-2 rounded-md border px-3 py-2 text-sm ${toneClasses("warning")}`}>
          <span className="font-medium tabular-nums">{formatMoney(summary.pending)} clearing</span> —{" "}
          {CLEARING_NOTE} It comes off the balance once it lands.
        </p>
      ) : null}

      {rows.length === 0 ? (
        // Workiz's empty state: the picture, "+ Add payments", a rule under.
        <div className="flex flex-col items-center gap-2.5 border-b border-[#e6e6e6] pt-[69px] pb-6">
          <PaymentsArt />
          {canCollect ? (
            <button
              type="button"
              onClick={() => setRecording(true)}
              className="inline-flex h-8 items-center gap-2 rounded-pill px-3 text-[13px] leading-[19px] font-semibold tracking-[0.2px] text-foreground hover:bg-[#f3f6f7]"
            >
              <Plus className="size-4" strokeWidth={1.5} /> <span className="px-1">Add payments</span>
            </button>
          ) : (
            <p className="text-[13px]">No payments on this job yet.</p>
          )}
        </div>
      ) : (
        <div className="mt-5 overflow-x-auto">
          {/* Workiz's columns, 313 / 224 / 387 / 197 / 183 of 1305px (N9YA2L). */}
          <table className="w-full min-w-[46rem] table-fixed border-separate border-spacing-0 border-b border-[#cccccc] text-[13px] leading-4">
            <thead>
              <tr>
                <th className={cn(TH, "w-[24%]")}>Type</th>
                <th className={cn(TH, "w-[17.2%]")}>Amount</th>
                <th className={cn(TH, "w-[29.7%]")}>Date</th>
                <th className={cn(TH, "w-[15.1%]")}>Status</th>
                <th className={cn(TH, "w-[14%]")} aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const receiptable = p.status === "settled" || p.status === "refunded";
                const resending = resend.isPending && resend.variables === p.id;
                const canResend = canCollect && receiptable;
                const canGiveBackThis = canGiveBack && canRefund(p);
                return (
                  <tr key={p.id}>
                    {/* Workiz's one line, "Cash By referral"; the reference or note on hover. */}
                    <td className={TD} title={p.reference || p.note || undefined}>
                      <span className="flex items-center gap-1.5 truncate whitespace-nowrap">
                        <span>{paymentLabel(p)}</span>
                        {p.last4 ? (
                          <span className="text-[#666666]">
                            ·{p.cardBrand ? ` ${p.cardBrand}` : ""} ••••{p.last4}
                          </span>
                        ) : null}
                        <span className="ml-1">By {p.chargedByReferral ? "referral" : collectedBy(p.takenBy)}</span>
                      </span>
                    </td>
                    <td className={cn(TD, "tabular-nums")}>
                      {formatMoney(p.amount)}
                      {p.tipAmount ? (
                        <span className="block text-[12px] text-[#666666]">+ {formatMoney(p.tipAmount)} tip</span>
                      ) : null}
                      {(p.refundedAmount ?? 0) > 0 ? (
                        <span className="block text-[12px] text-[#666666]">−{formatMoney(p.refundedAmount)} refunded</span>
                      ) : null}
                    </td>
                    <td className={cn(TD, "whitespace-nowrap")}>{workizDateTime(p.takenAt) || formatYmd(p.takenAt)}</td>
                    <td className={cn(TD, "pl-2.5")}>
                      <PaymentStatusBadge status={p.status} />
                    </td>
                    <td className={cn(TD, "pr-[33px] text-right")}>
                      <PaymentRowMenu
                        payment={p}
                        canResend={canResend}
                        canRefund={canGiveBackThis}
                        // Deleting needs the same right as refunding (the server's rule).
                        canDelete={canGiveBack && canDeletePayment(p)}
                        resending={resending}
                        onResend={() => resend.mutate(p.id)}
                        onRefund={() => setRefunding(p)}
                        onDelete={() => setDeleting(p)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {canCollect ? (
        <RecordPaymentDialog
          invoiceId={deal.id}
          dealId={deal.id}
          contactId={deal.contactId}
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

      {canGiveBack ? (
        <DeletePaymentDialog payment={deleting} invoiceId={deal.id} dealId={deal.id} onOpenChange={(o) => !o && setDeleting(null)} />
      ) : null}
    </section>
  );
}
