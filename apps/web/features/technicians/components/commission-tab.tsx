"use client";

import { useState } from "react";
import { useForm, type UseFormRegisterReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/features/users/lib";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCommission, useCommissionHistory, useCommissionCalc, useSetCommission } from "../hooks";
import { commissionSchema, type CommissionValues } from "../schemas";
import { formatMoney, formatPct } from "../lib";

export function CommissionTab({ technicianId }: { technicianId: string }) {
  const { can } = usePermissions();
  const { data: config, isLoading } = useCommission(technicianId);
  const { data: history } = useCommissionHistory(technicianId);
  const canEdit = can("commission", "edit");
  const [editOpen, setEditOpen] = useState(false);

  if (isLoading) return <Skeleton className="h-72 w-full max-w-2xl" />;

  if (!config) {
    return (
      <div className="max-w-2xl">
        <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-12 text-center">
          <div className="text-sm font-medium">No commission set</div>
          <p className="max-w-sm text-sm text-muted-foreground">
            Configure a base rate and fees to complete onboarding and enable payouts.
          </p>
          {canEdit ? (
            <Button variant="outline" className="gap-1.5" onClick={() => setEditOpen(true)}>
              <Pencil className="size-3.5" /> Set commission
            </Button>
          ) : null}
        </div>
        <EditDialog technicianId={technicianId} open={editOpen} onOpenChange={setEditOpen} />
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start gap-3">
        <Stat label="Base rate" value={formatPct(config.baseRatePct)} />
        <Stat label="Card fee" value={formatPct(config.creditCardFeePct)} />
        <Stat label="ACH fee" value={formatPct(config.achFeePct)} />
        {canEdit ? (
          <Button variant="outline" size="sm" className="ml-auto gap-1.5" onClick={() => setEditOpen(true)}>
            <Pencil className="size-3.5" /> Edit
          </Button>
        ) : null}
      </div>

      <Calculator technicianId={technicianId} />

      {history && history.length > 0 ? (
        <section>
          <Label className="mb-2 block text-[11px] tracking-wide uppercase">History</Label>
          <div className="divide-y rounded-lg border text-sm">
            {history.map((h, i) => (
              <div key={h.effectiveDate + i} className="flex items-center justify-between px-3 py-2">
                <span className="font-medium tabular-nums">
                  {formatPct(h.baseRatePct)} base · {formatPct(h.creditCardFeePct)} card · {formatPct(h.achFeePct)} ACH
                </span>
                <span className="text-xs text-muted-foreground">
                  from {formatDate(h.effectiveDate)}
                  {i === 0 ? " · current" : ""}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <EditDialog technicianId={technicianId} open={editOpen} onOpenChange={setEditOpen} />
    </div>
  );
}

function Calculator({ technicianId }: { technicianId: string }) {
  const [revenue, setRevenue] = useState(350);
  const [tax, setTax] = useState(28);
  const [partsCost, setPartsCost] = useState(45);
  const [paidByCard, setPaidByCard] = useState(true);
  const { data: breakdown, isFetching } = useCommissionCalc(technicianId, {
    revenue,
    tax,
    partsCost,
    paidByCard,
  });

  return (
    <section>
      <Label className="mb-2 block text-[11px] tracking-wide uppercase">Payout calculator</Label>
      <div className="grid overflow-hidden rounded-lg border sm:grid-cols-2">
        <div className="space-y-2 border-b bg-muted/30 p-4 sm:border-r sm:border-b-0">
          <CalcInput label="Revenue" value={revenue} onChange={setRevenue} />
          <CalcInput label="Tax" value={tax} onChange={setTax} />
          <CalcInput label="Parts cost" value={partsCost} onChange={setPartsCost} />
          <label className="flex items-center justify-between pt-1 text-sm">
            <span>Paid by card</span>
            <input type="checkbox" checked={paidByCard} onChange={(e) => setPaidByCard(e.target.checked)} className="size-4 accent-[var(--brand)]" />
          </label>
        </div>
        <div className="p-4">
          {breakdown ? (
            <dl className="space-y-1.5 text-sm">
              <CalcRow label="Base profit" value={formatMoney(breakdown.baseProfit)} />
              <CalcRow label="Tech share" value={formatMoney(breakdown.techShare)} />
              <CalcRow label="Deduction" value={`−${formatMoney(breakdown.deduction)}`} />
              <div className="mt-1 flex items-center justify-between border-t pt-2 text-base font-semibold">
                <span>Net payout</span>
                <span className="tabular-nums text-green-600 dark:text-green-500">{formatMoney(breakdown.netPayout)}</span>
              </div>
            </dl>
          ) : (
            <div className="flex h-full items-center gap-2 text-sm text-muted-foreground">
              {isFetching ? <Loader2 className="size-4 animate-spin" /> : null} Pricing…
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function CalcInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <Input type="number" min="0" value={value} onChange={(e) => onChange(Number(e.target.value))} className="h-8 w-28 text-right tabular-nums" />
    </label>
  );
}
function CalcRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function EditDialog({
  technicianId,
  open,
  onOpenChange,
}: {
  technicianId: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const set = useSetCommission();
  const { data: config } = useCommission(technicianId, open);
  const form = useForm<CommissionValues>({
    resolver: zodResolver(commissionSchema),
    defaultValues: {
      baseRatePct: config?.baseRatePct ?? 40,
      creditCardFeePct: config?.creditCardFeePct ?? 3,
      achFeePct: config?.achFeePct ?? 0,
    },
  });

  const onSubmit = (v: CommissionValues) =>
    set.mutate(
      { id: technicianId, body: { baseRatePct: v.baseRatePct, creditCardFeePct: v.creditCardFeePct, achFeePct: v.achFeePct } },
      { onSuccess: () => onOpenChange(false) },
    );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set commission</DialogTitle>
          <DialogDescription>Saves a new effective-dated version; prior rates are kept.</DialogDescription>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4" noValidate>
          <div className="grid grid-cols-3 gap-3">
            <PctField label="Base rate" reg={form.register("baseRatePct")} err={form.formState.errors.baseRatePct?.message} />
            <PctField label="Card fee" reg={form.register("creditCardFeePct")} />
            <PctField label="ACH fee" reg={form.register("achFeePct")} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="brand" className="gap-1.5" disabled={set.isPending}>
              {set.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PctField({
  label,
  reg,
  err,
}: {
  label: string;
  reg: UseFormRegisterReturn;
  err?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <div className="relative">
        <Input type="number" min="0" max="100" step="0.1" className="h-10 pr-7 tabular-nums" {...reg} />
        <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-sm text-muted-foreground">%</span>
      </div>
      {err ? <p className="text-xs text-destructive">{err}</p> : null}
    </div>
  );
}
