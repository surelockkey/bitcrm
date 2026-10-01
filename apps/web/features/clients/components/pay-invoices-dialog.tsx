"use client";

import { useMemo, useState } from "react";
import type { Invoice } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/features/deals/lib";
import { InvoiceStatusBadge } from "@/features/invoices/components/invoice-status-badge";
import { RecordPaymentDialog } from "@/features/payments/components/record-payment-dialog";

/** The invoices Workiz's "Pay N Invoices" lists: anything still owing. */
export const unpaidInvoices = (invoices: Invoice[]): Invoice[] => invoices.filter((i) => (i.totals?.balanceDue ?? 0) > 0);

/**
 * Workiz's "Pay N Invoices" from Create new: the client's open invoices with
 * checkboxes and a total, then Continue. BitCRM records a payment per
 * invoice, so Continue walks the chosen ones through the record-payment
 * dialog in turn, each prefilled with its balance.
 */
export function PayInvoicesDialog({
  invoices,
  open,
  onOpenChange,
}: {
  /** The client's invoices; the dialog keeps the unpaid ones. */
  invoices: Invoice[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const unpaid = useMemo(() => unpaidInvoices(invoices), [invoices]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<Invoice[]>([]);
  const chosen = unpaid.filter((i) => !excluded.has(i.id));
  const total = chosen.reduce((s, i) => s + (i.totals?.balanceDue ?? 0), 0);

  const toggle = (id: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setExcluded(chosen.length === unpaid.length ? new Set(unpaid.map((i) => i.id)) : new Set());

  const start = () => {
    setQueue(chosen);
    onOpenChange(false);
  };
  const current = queue[0];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Pay {unpaid.length} invoice{unpaid.length === 1 ? "" : "s"}
            </DialogTitle>
            <DialogDescription>Select invoices for bulk payment</DialogDescription>
          </DialogHeader>
          {unpaid.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing is owing.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              <li>
                <label className="flex items-center gap-2">
                  <Checkbox checked={chosen.length === unpaid.length} onCheckedChange={toggleAll} aria-label={`Select all (${unpaid.length})`} />
                  Select All ({unpaid.length})
                </label>
              </li>
              {unpaid.map((inv) => (
                <li key={inv.id}>
                  <label className="flex items-center gap-2">
                    <Checkbox
                      checked={!excluded.has(inv.id)}
                      onCheckedChange={() => toggle(inv.id)}
                      aria-label={`Invoice #${inv.number} • ${formatMoney(inv.totals?.balanceDue ?? 0)}`}
                    />
                    <span className="flex-1">
                      Invoice #{inv.number} • {formatMoney(inv.totals?.balanceDue ?? 0)}
                    </span>
                    <InvoiceStatusBadge status={inv.status} />
                  </label>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between border-t pt-3 text-sm font-medium">
            <span>Total:</span>
            <span className="tabular-nums">{formatMoney(total)}</span>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" variant="brand" onClick={start} disabled={chosen.length === 0}>
              Continue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {current ? (
        <RecordPaymentDialog
          key={current.id}
          invoiceId={current.id}
          dealId={current.dealId}
          balanceDue={current.totals?.balanceDue ?? 0}
          open
          onOpenChange={(o) => {
            if (!o) setQueue((q) => q.slice(1));
          }}
        />
      ) : null}
    </>
  );
}
