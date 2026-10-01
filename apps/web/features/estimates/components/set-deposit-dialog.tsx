"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { estimateDepositDue, type Estimate } from "@bitcrm/types";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/features/billing/lib";

export type DepositPatch = { depositPercentage: number | null; depositAmount: number | null };

/** Workiz's deposit title: "1755.61 (50.00%)" — the amount due, and the percent when it is one. */
export function depositLabel(e: Pick<Estimate, "depositAmount" | "depositPercentage" | "totals" | "workizTotal">): string | null {
  const due = estimateDepositDue(e);
  if (!(due > 0)) return null;
  const pct = e.depositPercentage;
  return pct && !(e.depositAmount && e.depositAmount > 0) ? `${formatMoney(due)} (${trimPct(pct)}%)` : formatMoney(due);
}

const trimPct = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, ""));

/**
 * Workiz "Set deposit": a dollar amount or a percent of the total, with
 * "Set for future estimates" to make it the account default.
 */
export function SetDepositDialog({
  open,
  onOpenChange,
  total,
  current,
  canSetDefault,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  total: number;
  current: Pick<Estimate, "depositAmount" | "depositPercentage">;
  /** `settings.edit` — the "future estimates" box writes the account default. */
  canSetDefault: boolean;
  onSave: (patch: DepositPatch, setForFuture: boolean) => Promise<unknown> | void;
  saving?: boolean;
}) {
  const startsAsPercent = !(current.depositAmount && current.depositAmount > 0) && !!current.depositPercentage;
  const [mode, setMode] = useState<"amount" | "percent">(startsAsPercent ? "percent" : "amount");
  const [value, setValue] = useState<string>(
    startsAsPercent ? String(current.depositPercentage) : current.depositAmount ? String(current.depositAmount) : "0",
  );
  const [future, setFuture] = useState(false);

  const n = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(n) && n >= 0 && (mode === "amount" || n <= 100);
  const error = !valid
    ? mode === "percent"
      ? "Enter a percent between 0 and 100"
      : "Enter an amount of 0 or more"
    : null;
  const due = valid ? (mode === "percent" ? Math.round(total * n) / 100 : n) : 0;

  const save = async () => {
    if (!valid) return;
    const patch: DepositPatch =
      n <= 0
        ? { depositPercentage: null, depositAmount: null }
        : mode === "percent"
          ? { depositPercentage: n, depositAmount: null }
          : { depositAmount: n, depositPercentage: null };
    await onSave(patch, canSetDefault && future);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Set deposit</DialogTitle>
          <DialogDescription>
            What the client pays when approving this estimate. Collected on the portal right after they sign.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <div role="radiogroup" aria-label="Deposit type" className="flex rounded-md border">
              {(["amount", "percent"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  aria-label={m === "amount" ? "$" : "%"}
                  className={cn("px-3 text-sm", mode === m ? "bg-muted font-semibold" : "text-muted-foreground")}
                  onClick={() => setMode(m)}
                >
                  {m === "amount" ? "$" : "%"}
                </button>
              ))}
            </div>
            <div className="flex-1 space-y-1">
              <Input
                id="deposit-value"
                type="number"
                inputMode="decimal"
                min={0}
                max={mode === "percent" ? 100 : undefined}
                step={mode === "percent" ? 1 : 0.01}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                aria-label="Deposit amount"
              />
            </div>
          </div>
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {due > 0 ? `${formatMoney(due)} of ${formatMoney(total)} due on approval.` : "No deposit asked for."}
            </p>
          )}
          {canSetDefault ? (
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={future} onCheckedChange={(v) => setFuture(v === true)} aria-label="Set for future estimates" />
              Set for future estimates
            </label>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Close
          </Button>
          <Button variant="brand" onClick={save} disabled={!valid || saving}>
            {saving ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
