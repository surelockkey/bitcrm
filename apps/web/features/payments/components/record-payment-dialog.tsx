"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getApiErrorMessage } from "@/lib/api/errors";
import { todayYmd } from "@/features/billing/dates";
import { useRecordPayment, type RecordPaymentTarget } from "../hooks";
import { OFFLINE_METHOD_LABEL, OFFLINE_PAYMENT_METHODS, parseMoney, takenAtIso } from "../lib";
import { recordPaymentSchema, type RecordPaymentValues } from "../schemas";

/**
 * "Record payment" — money the client handed over off-line: cash, a cheque, a
 * card swiped on a terminal, anything else. Online card and bank payments come
 * back from Stripe on their own and are never keyed in here.
 */
export function RecordPaymentDialog({
  invoiceId,
  dealId,
  balanceDue,
  open,
  onOpenChange,
  target = "invoice",
}: {
  invoiceId: string;
  dealId?: string;
  /** Prefills the amount — the common case is "they paid the rest". */
  balanceDue: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `job` records on the job's ledger (the Payments tab) — no invoice needed. */
  target?: RecordPaymentTarget;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record a payment</DialogTitle>
          <DialogDescription>
            Money taken outside the client portal. It comes off the{" "}
            {target === "job" ? "job" : "invoice"} balance straight away.
          </DialogDescription>
        </DialogHeader>
        {/* Remounted per open so the amount re-seeds from the current balance. */}
        {open ? (
          <RecordPaymentForm
            invoiceId={invoiceId}
            dealId={dealId}
            balanceDue={balanceDue}
            target={target}
            onDone={() => onOpenChange(false)}
            onCancel={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function RecordPaymentForm({
  invoiceId,
  dealId,
  balanceDue,
  target,
  onDone,
  onCancel,
}: {
  invoiceId: string;
  dealId?: string;
  balanceDue: number;
  target: RecordPaymentTarget;
  onDone: () => void;
  onCancel: () => void;
}) {
  const record = useRecordPayment(invoiceId, dealId, target);
  const [error, setError] = useState<string | null>(null);
  const today = todayYmd();

  const form = useForm<RecordPaymentValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      amount: balanceDue > 0 ? balanceDue.toFixed(2) : "",
      method: "cash",
      reference: "",
      note: "",
      takenAt: today,
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    record.mutate(
      {
        amount: parseMoney(values.amount),
        method: values.method,
        reference: values.reference || undefined,
        note: values.note || undefined,
        takenAt: takenAtIso(values.takenAt),
      },
      {
        onSuccess: onDone,
        onError: (e) => setError(getApiErrorMessage(e, "The payment couldn't be recorded")),
      },
    );
  });

  return (
    <Form {...form}>
      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="amount"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Amount</FormLabel>
                <FormControl>
                  <Input type="text" inputMode="decimal" placeholder="0.00" className="tabular-nums" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="takenAt"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Date received</FormLabel>
                <FormControl>
                  <Input type="date" max={today} {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <FormField
          control={form.control}
          name="method"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Method</FormLabel>
              <Select value={field.value} onValueChange={field.onChange}>
                <FormControl>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  {OFFLINE_PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {OFFLINE_METHOD_LABEL[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="reference"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Reference (optional)</FormLabel>
              <FormControl>
                <Input maxLength={120} placeholder="Cheque number, confirmation code…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="note"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Note (optional)</FormLabel>
              <FormControl>
                <Textarea rows={2} maxLength={1000} placeholder="Paid to the tech on site…" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel} disabled={record.isPending}>
            Cancel
          </Button>
          <Button type="submit" variant="brand" disabled={record.isPending}>
            {record.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Record payment
          </Button>
        </DialogFooter>
      </form>
    </Form>
  );
}
