"use client";

import { Loader2, MoreVertical, Receipt, Trash2, Undo2 } from "lucide-react";
import type { Payment } from "@bitcrm/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { WZ_MENU_POPUP, WZ_MENU_POPUP_ITEM } from "@/components/workiz/menu-popup";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/features/billing/lib";
import { paymentLabel } from "../lib";

/** "the $100.00 cash payment" — how a row's controls and dialogs name it. */
export function describePayment(p: Pick<Payment, "amount" | "method" | "methodDetail" | "methodLabel">): string {
  return `the ${formatMoney(p.amount)} ${paymentLabel(p).toLowerCase()} payment`;
}

/**
 * The ⋮ on a payment row — Workiz's MenuPopup with Resend receipt, Refund and
 * Delete, each only when the caller may and the payment allows (nothing at
 * all when none applies). Radix draws the panel in a portal: the ledger
 * table scrolls sideways (`overflow-x: auto`, which clips below as well), and
 * a panel hung inside that wrapper was invisible on a one-row ledger.
 */
export function PaymentRowMenu({
  payment,
  canResend,
  canRefund,
  canDelete,
  resending,
  onResend,
  onRefund,
  onDelete,
  className,
}: {
  payment: Pick<Payment, "amount" | "method" | "methodDetail" | "methodLabel">;
  canResend: boolean;
  canRefund: boolean;
  canDelete: boolean;
  resending?: boolean;
  onResend: () => void;
  onRefund: () => void;
  onDelete: () => void;
  className?: string;
}) {
  if (!canResend && !canRefund && !canDelete) return null;
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${describePayment(payment)}`}
          className={cn(
            "inline-grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-wz-secondary-hover data-[state=open]:bg-wz-secondary-hover",
            className,
          )}
        >
          <MoreVertical className="size-6" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8} alignOffset={-4} className={WZ_MENU_POPUP}>
        {canResend ? (
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} disabled={resending} onSelect={onResend}>
            {resending ? <Loader2 className="animate-spin" /> : <Receipt strokeWidth={1.25} />} Resend receipt
          </DropdownMenuItem>
        ) : null}
        {canRefund ? (
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} onSelect={onRefund}>
            <Undo2 strokeWidth={1.25} /> Refund
          </DropdownMenuItem>
        ) : null}
        {canDelete ? (
          // Workiz keeps Delete in ink here (WZ_MENU_POPUP_ITEM); the variant is for assistive tech.
          <DropdownMenuItem className={WZ_MENU_POPUP_ITEM} variant="destructive" onSelect={onDelete}>
            <Trash2 strokeWidth={1.25} /> Delete
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
