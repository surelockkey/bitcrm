"use client";

import { lazy, Suspense, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { WzButton } from "@/components/workiz/button";
import { WzSelect } from "@/components/workiz/select";
import { WzTextField } from "@/components/workiz/text-field";
import { WzTextarea } from "@/components/workiz/textarea";
import { WzCheckbox } from "@/components/workiz/toggles";
import { formatMoney } from "@/features/billing/lib";
import { getApiErrorMessage } from "@/lib/api/errors";
import { ctToday } from "@/lib/timezone";
import { usePaymentSettings, useRecordPayment, type RecordPaymentTarget } from "../hooks";
import { addPaymentTypes, canChargeCard, parseMoney, takenAtIso } from "../lib";
import { recordPaymentSchema, toRecordPaymentBody, type RecordPaymentValues } from "../schemas";
import { PAYMENT_BOX, PAYMENT_BUTTON, PAYMENT_FOOTER, PAYMENT_PAIR } from "./payment-boxes";

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
      {/* Workiz's 520px window; the balance line 20px under the title, the
          boxes 10px under it (payment-boxes.ts). */}
      <DialogContent
        className="gap-2.5 sm:max-w-[520px]"
        // Workiz opens it with every box at rest (the balance in Amount is not
        // selected): the window takes the focus, so Tab starts inside it.
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement | null)?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Add payment</DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-5 font-semibold text-foreground">
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

  const errors = form.formState.errors;
  const box = { overhang: false, inputClassName: PAYMENT_BOX } as const;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2.5" noValidate>
      <div className={PAYMENT_PAIR}>
        <WzTextField
          {...box}
          {...form.register("amount")}
          label="Amount"
          inputMode="decimal"
          error={errors.amount?.message}
        />
        <Controller
          control={form.control}
          name="type"
          render={({ field }) => (
            <WzSelect
              label="Payment type"
              options={types}
              value={field.value}
              onChange={field.onChange}
              onBlur={field.onBlur}
              separator={false}
              // Workiz's Add payment draws the chosen type at 14px, not the job page's 16px.
              className="[&_[data-slot=wz-select-value]]:text-[14px]"
            />
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
          <div className={PAYMENT_PAIR}>
            <WzTextField
              {...box}
              {...form.register("reference")}
              label="Confirmation code"
              maxLength={120}
              error={errors.reference?.message}
            />
            <WzTextField
              {...box}
              {...form.register("takenAt")}
              label="Paid on"
              type="date"
              max={today}
              error={errors.takenAt?.message}
            />
          </div>

          <WzCheckbox {...form.register("chargedByReferral")} label="Charged by referral" className="self-start" />

          <WzTextarea
            {...form.register("note")}
            placeholder="Note (optional)"
            maxLength={1000}
            error={errors.note?.message}
          />

          {error ? (
            <p role="alert" className="text-sm text-wz-error">
              {error}
            </p>
          ) : null}

          <DialogFooter className={PAYMENT_FOOTER}>
            <WzButton variant="secondary" size="regular" className={PAYMENT_BUTTON} onClick={onDone} disabled={record.isPending}>
              Close
            </WzButton>
            <WzButton type="submit" variant="primary" size="regular" className={PAYMENT_BUTTON} loading={record.isPending}>
              Add payment
            </WzButton>
          </DialogFooter>
        </>
      )}
    </form>
  );
}
