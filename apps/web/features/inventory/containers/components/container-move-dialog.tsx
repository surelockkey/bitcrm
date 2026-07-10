"use client";

import { useState } from "react";
import { Loader2, TriangleAlert } from "lucide-react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LocationType } from "@bitcrm/types";
import { cn } from "@/lib/utils";
import { useWarehouses, useContainers, useCreateTransfer } from "@/features/inventory/warehouses/hooks";
import { containerLabel } from "@/features/inventory/warehouses/lib";
import type { ContainerMoveTarget } from "./container-stock-tab";

type Mode = "return" | "handoff";

export function ContainerMoveDialog({
  containerId,
  item,
  open,
  onOpenChange,
}: {
  containerId: string;
  item: ContainerMoveTarget | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [mode, setMode] = useState<Mode>("return");
  const [destId, setDestId] = useState("");
  const [qty, setQty] = useState(1);
  const transfer = useCreateTransfer();
  const { data: warehouses } = useWarehouses();
  const { data: containers } = useContainers(open);

  const close = (o: boolean) => {
    if (!o) {
      setMode("return");
      setDestId("");
      setQty(1);
    }
    onOpenChange(o);
  };

  if (!item) return null;

  const destinations =
    mode === "return"
      ? (warehouses?.data ?? []).map((w) => ({ id: w.id, label: w.name }))
      : (containers?.data ?? [])
          .filter((c) => c.id !== containerId)
          .map((c) => ({ id: c.id, label: containerLabel(c) + (c.department ? ` · ${c.department}` : "") }));

  const overStock = qty > item.onHand;
  const valid = destId && qty >= 1 && !overStock;

  const submit = () => {
    transfer.mutate(
      {
        fromType: LocationType.CONTAINER,
        fromId: containerId,
        toType: mode === "return" ? LocationType.WAREHOUSE : LocationType.CONTAINER,
        toId: destId,
        items: [{ productId: item.productId, productName: item.productName, quantity: qty }],
      },
      { onSuccess: () => close(false) },
    );
  };

  const setModeReset = (m: Mode) => {
    setMode(m);
    setDestId("");
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move stock</DialogTitle>
          <DialogDescription>
            Move <b>{item.productName}</b> out of this van.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 rounded-lg border p-1">
          {(["return", "handoff"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setModeReset(m)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === m ? "bg-brand text-white" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "return" ? "Return to warehouse" : "Handoff to container"}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>{mode === "return" ? "To warehouse" : "To container"}</Label>
            <Select value={destId} onValueChange={setDestId}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder={mode === "return" ? "Pick a warehouse" : "Pick a container"} />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {destinations.length === 0 ? (
              <p className="text-xs text-muted-foreground">No destinations available.</p>
            ) : null}
          </div>

          <div className="space-y-1.5">
            <Label>Quantity</Label>
            <Input
              type="number"
              min={1}
              max={item.onHand}
              value={qty}
              onChange={(e) => setQty(Number(e.target.value))}
              className="h-10 w-28 tabular-nums"
            />
            <p className="text-xs text-muted-foreground">{item.onHand} on hand</p>
          </div>

          {overStock ? (
            <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
              <TriangleAlert className="mt-0.5 size-4 flex-none" />
              Can&apos;t move more than on hand — the server rejects it.
            </div>
          ) : null}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            container → {mode === "return" ? "warehouse" : "container"}
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button variant="brand" className="gap-1.5" disabled={!valid || transfer.isPending} onClick={submit}>
              {transfer.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              {mode === "return" ? "Return" : "Handoff"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
