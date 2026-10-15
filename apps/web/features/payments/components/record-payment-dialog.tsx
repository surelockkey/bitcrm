"use client";

import { lazy, Suspense, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Plus } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMoney } from "@/features/billing/lib";
import { getApiErrorMessage } from "@/lib/api/errors";
import { ctToday } from "@/lib/timezone";
import { usePaymentSettings, useRecordPayment, type RecordPaymentTarget } from "../hooks";
import { addPaymentTypes, canChargeCard, parseMoney, takenAtIso } from "../lib";
import { recordPaymentSchema, toRecordPaymentBody, type RecordPaymentValues } from "../schemas";

/** Stripe's card form, fetched the first time Credit charge is picked. */
const CardChargeForm = lazy(() => import("./card-charge-form"));

/**
 * Workiz's "Add payment": an Amount (the balance by default) and a Payment
 * type, in Workiz's order — Credit charge, Cash, Credit offline, Check, Bank
 * transfer (offline), Cash app, Consumer financing, Venmo, Zelle, Debit
 * offline. Credit charge takes the card here through Stripe (when the
 * account's Stripe keys are set up and the payment is on a job); every other
 * type is money taken elsewhere, recorded with its Confirmation code, Paid on
 * date and "Charged by referral". Either way it lands on the job's ledger.
 *
 * Callers render it only for someone holding `payments.collect`.
 */
export function RecordPaymentDialog({
  invoiceId,
  dealId,
  contactId,
  balanceDue,
  open,
  onOpenChange,
  target = "invoice",
  allowCharge = true,
}: {
  invoiceId: string;
  dealId?: string;
  /** The client — Name on card starts as their name, the receipt email as theirs. */
  contactId?: string;
  /** Prefills the amount — the common case is "they paid the rest". */
  balanceDue: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `job` records on the job's ledger (the Payments tab) — no invoice needed. */
  target?: RecordPaymentTarget;
  /** False offers the offline types only (e.g. walking several invoices in turn). */
  allowCharge?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add payment</DialogTitle>
          <DialogDescription>
            {balanceDue > 0 ? `Balance due: ${formatMoney(balanceDue)}` : "This job doesn't have any balance"}
          </DialogDescription>
        </DialogHeader>
        {/* Remounted per open so the amount re-seeds from the current balance. */}
        {open ? (
          <AddPaymentForm
            invoiceId={invoiceId}
            dealId={dealId}
            contactId={contactId}
            balanceDue={balanceDue}
            target={target}
            allowCharge={allowCharge}
            onDone={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function AddPaymentForm({
  invoiceId,
  dealId,
  contactId,
  balanceDue,
  target,
  allowCharge,
  onDone,
}: {
  invoiceId: string;
  dealId?: string;
  contactId?: string;
  balanceDue: number;
  target: RecordPaymentTarget;
  allowCharge: boolean;
  onDone: () => void;
}) {
  const record = useRecordPayment(invoiceId, dealId, target);
  const settings = usePaymentSettings();
  const [error, setError] = useState<string | null>(null);
  const today = ctToday();
  // A card is charged on the JOB's ledger, so it needs the job.
  const canCharge = allowCharge && !!dealId && canChargeCard(settings.data);
  const types = addPaymentTypes({ canCharge });

  const form = useForm<RecordPaymentValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      amount: balanceDue > 0 ? balanceDue.toFixed(2) : "",
      type: "cash",
      reference: "",
      note: "",
      takenAt: today,
      chargedByReferral: false,
    },
  });
  const type = useWatch({ control: form.control, name: "type" });
  const typedAmount = Number(useWatch({ control: form.control, name: "amount" }));
  const charging = type === "charge" && canCharge;

  const resolveAmount = async (): Promise<number | null> =>
    (await form.trigger("amount")) ? parseMoney(form.getValues("amount")) : null;

  const onSubmit = form.handleSubmit((values) => {
    // Enter inside the card form submits this form too: a card is charged by its own button.
    if (values.type === "charge") return;
    setError(null);
    record.mutate(toRecordPaymentBody(values, takenAtIso(values.takenAt)), {
      onSuccess: onDone,
      onError: (e) => setError(getApiErrorMessage(e, "The payment couldn't be recorded")),
    });
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
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Payment type</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {types.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        {charging && dealId && settings.data?.publishableKey ? (
          <Suspense
            fallback={
              <div className="flex justify-center py-6" aria-busy="true">
                <Loader2 className="size-5 animate-spin text-muted-foreground" />
              </div>
            }
          >
            <CardChargeForm
              invoiceId={invoiceId}
              dealId={dealId}
              contactId={contactId}
              publishableKey={settings.data.publishableKey}
              surchargePercent={settings.data.surchargePercent ?? 0}
              surchargeLabel={settings.data.surchargeLabel || "Service fee"}
              amount={Number.isFinite(typedAmount) && typedAmount > 0 ? parseMoney(String(typedAmount)) : 0}
              resolveAmount={resolveAmount}
              onDone={onDone}
              onClose={onDone}
            />
          </Suspense>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField
                control={form.control}
                name="reference"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirmation code</FormLabel>
                    <FormControl>
                      <Input maxLength={120} {...field} />
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
                    <FormLabel>Paid on</FormLabel>
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
              name="chargedByReferral"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center gap-2 space-y-0">
                  <FormControl>
                    <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} />
                  </FormControl>
                  <FormLabel className="font-normal">Charged by referral</FormLabel>
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
              <Button type="button" variant="outline" onClick={onDone} disabled={record.isPending}>
                Close
              </Button>
              <Button type="submit" variant="brand" disabled={record.isPending}>
                {record.isPending ? <Loader2 className="animate-spin" /> : <Plus />} Add payment
              </Button>
            </DialogFooter>
          </>
        )}
      </form>
    </Form>
  );
}
