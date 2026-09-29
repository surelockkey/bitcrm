"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Undo2 } from "lucide-react";
import type { Payment } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatMoney } from "@/features/billing/lib";
import { useRefundPayment } from "../hooks";
import { parseMoney, paymentMethodLabel, refundAmountError, remainingRefundable } from "../lib";
import { refundSchema, type RefundValues } from "../schemas";

/**
 * Give money back — all of it, or part. Stripe payments are refunded through
 * Stripe; an offline payment is book-keeping only, and the dialog says so.
 */
export function RefundPaymentDialog({
  payment,
  invoiceId,
  dealId,
  open,
  onOpenChange,
}: {
  payment: Payment;
  invoiceId: string;
  dealId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Refund the {formatMoney(payment.amount)} {paymentMethodLabel(payment.method).toLowerCase()} payment
          </DialogTitle>
          <DialogDescription>
            {payment.stripePaymentIntentId
              ? "The money goes back the way it came. Card refunds take 5–10 business days to reach the client."
              : "This payment was taken outside the portal, so the refund is recorded here only — hand the money back yourself."}
          </DialogDescription>
        </DialogHeader>
        {open ? (
          <RefundForm
            key={payment.id}
            payment={payment}
            invoiceId={invoiceId}
            dealId={dealId}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RefundForm({
  payment,
  invoiceId,
  dealId,
  onDone,
  onCancel,
}: {
  payment: Payment;
  invoiceId: string;
  dealId?: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const refund = useRefundPayment(invoiceId, dealId);
  const [error, setError] = useState<string | null>(null);
  const remaining = remainingRefundable(payment);

  const form = useForm<RefundValues>({
    resolver: zodResolver(refundSchema),
    defaultValues: {
      amount: remaining > 0 ? remaining.toFixed(2) : "",
      reason: "",
      sendReceipt: true,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    // The server clamps as well — this keeps a doomed request from going out.
    const why = refundAmountError(payment, values.amount);
    if (why) {
      form.setError("amount", { message: why });
      return;
    }
    setError(null);
    refund.mutate(
      {
        paymentId: payment.id,
        amount: parseMoney(values.amount),
        reason: values.reason || undefined,
        sendReceipt: values.sendReceipt,
      },
      {
        onSuccess: onDone,
        onError: (e) => setError(getApiErrorMessage(e, "The refund couldn't be sent")),
      },
    );
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <FormField
          control={form.control}
          name="amount"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Refund amount</FormLabel>
              <FormControl>
                <Input
                  type="text"
                  inputMode="decimal"
                  placeholder="0.00"
                  className="tabular-nums"
                  disabled={remaining <= 0}
                  {...field}
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {remaining > 0
                  ? `${formatMoney(remaining)} of the ${formatMoney(payment.amount)} can still be refunded.`
                  : "There's nothing left to refund on this payment."}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="reason"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reason (optional)</FormLabel>
              <FormControl>
                <Textarea
                  rows={2}
                  maxLength={500}
                  placeholder="Shown to the client on the refund receipt"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="sendReceipt"
          render={({ field }) => (
            <FormItem>
              <label className="flex items-center gap-2 text-sm">
                <FormControl>
                  <Checkbox
                    checked={field.value}
                    onCheckedChange={(v) => field.onChange(v === true)}
                    aria-label="Email the client a receipt"
                  />
                </FormControl>
                Email the client a receipt
              </label>
            </FormItem>
          )}
        />

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={refund.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="brand" disabled={refund.isPending || remaining <= 0}>
            {refund.isPending ? <Loader2 className="animate-spin" /> : <Undo2 />} Refund
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
