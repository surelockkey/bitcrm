"use client";

import { Loader2 } from "lucide-react";
import type { Payment } from "@bitcrm/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useDeletePayment } from "../hooks";
import { describePayment } from "./payment-row-menu";

/**
 * Workiz's Delete on a payment row asks first. The row comes off the job's
 * ledger for good, the balance goes back up and the history reads "Deleted
 * payment 100 cash" — so this is for money keyed in by mistake; money that was
 * collected and handed back is a refund. Stays open with the server's reason
 * when it refuses (a Stripe payment, 409).
 */
export function DeletePaymentDialog({
  payment,
  invoiceId,
  dealId,
  onOpenChange,
}: {
  /** The payment to delete; `null` keeps the dialog closed. */
  payment: Payment | null;
  invoiceId: string;
  dealId?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const remove = useDeletePayment(invoiceId, dealId);
  return (
    <AlertDialog open={payment !== null} onOpenChange={(o) => !o && !remove.isPending && onOpenChange(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this payment?</AlertDialogTitle>
          <AlertDialogDescription>
            {payment ? (
              <>
                {capitalize(describePayment(payment))} comes off the job for good and its balance goes back up. Money
                that was collected and handed back is a refund, not a delete.
              </>
            ) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={remove.isPending}
            onClick={(e) => {
              // Radix closes on Action by default; stay open until the server has answered.
              e.preventDefault();
              if (payment) remove.mutate(payment, { onSuccess: () => onOpenChange(false) });
            }}
            className="bg-destructive text-white hover:bg-destructive/90"
          >
            {remove.isPending ? <Loader2 className="animate-spin" /> : null}
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
