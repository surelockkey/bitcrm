"use client";

import { Layers, Loader2 } from "lucide-react";
import type { ItemGroup } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/features/deals/lib";

/**
 * Item groups among an Add item picker's results (Workiz: "Add item … then
 * add your item group — it works like any other item"). A group adds every
 * one of its items in one go. Drawn in the look of the picker it sits in.
 */
export function ItemGroupChoices({
  groups,
  onPick,
  limit,
}: {
  groups: readonly ItemGroup[];
  onPick: (group: ItemGroup) => void;
  /** Show at most this many (nothing typed yet) and say how to find the rest. */
  limit?: number;
}) {
  if (groups.length === 0) return null;
  const shown = limit !== undefined ? groups.slice(0, limit) : groups;
  const rest = groups.length - shown.length;
  return (
    <div data-testid="item-group-choices" className="min-w-0 space-y-1.5">
      <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">Item groups</p>
      {shown.map((g) => (
        <button
          key={g.id}
          type="button"
          onClick={() => onPick(g)}
          className="flex w-full items-center gap-2.5 rounded-lg border p-2 text-left hover:bg-accent/50"
        >
          <span className="grid size-7 flex-none place-items-center rounded-md border bg-muted text-muted-foreground">
            <Layers className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{g.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">
              {g.members.length} {g.members.length === 1 ? "item" : "items"} · {formatMoney(g.total)}
            </div>
          </div>
        </button>
      ))}
      {rest > 0 ? (
        <p className="text-[11px] text-muted-foreground">
          Type to find the other {rest} {rest === 1 ? "group" : "groups"}
        </p>
      ) : null}
    </div>
  );
}

/** The group's lines before they go on: each item, quantity × price, the total, and the button that adds them. */
export function ItemGroupConfirm({
  group,
  submitLabel,
  note,
  pending = false,
  onBack,
  onSubmit,
}: {
  group: ItemGroup;
  submitLabel: string;
  /** Where the parts come from (the job's van rule), when it matters. */
  note?: string;
  pending?: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <div data-testid="item-group-confirm" className="min-w-0 space-y-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 flex-none place-items-center rounded-md border bg-muted text-muted-foreground">
          <Layers className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{group.name}</div>
          {group.description ? <div className="truncate text-xs text-muted-foreground">{group.description}</div> : null}
        </div>
      </div>
      <ul className="min-w-0 divide-y rounded-lg border">
        {group.members.map((m, i) => (
          <li key={`${m.productId}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{m.name}</span>
            <span className="flex-none font-mono text-xs tabular-nums text-muted-foreground">
              {`${m.quantity} × ${formatMoney(m.priceClient)}`}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium">Total</span>
        <span className="font-mono font-semibold tabular-nums">{formatMoney(group.total)}</span>
      </div>
      {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      <div className="flex justify-between gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onBack} disabled={pending}>
          ← Back
        </Button>
        <Button type="button" onClick={onSubmit} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : null}
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}
