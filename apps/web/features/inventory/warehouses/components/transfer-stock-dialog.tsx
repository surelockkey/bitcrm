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
import { useContainers, useCreateTransfer } from "../hooks";
import { containerLabel } from "../lib";

export interface TransferTarget {
  productId: string;
  productName: string;
  onHand: number;
}

export function TransferStockDialog({
  warehouseId,
  item,
  open,
  onOpenChange,
}: {
  warehouseId: string;
  item: TransferTarget | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: containers } = useContainers(open);
  const transfer = useCreateTransfer();
  const [containerId, setContainerId] = useState("");
  const [qty, setQty] = useState(1);

  const list = containers?.data ?? [];
  const close = (o: boolean) => {
    if (!o) {
      setContainerId("");
      setQty(1);
    }
    onOpenChange(o);
  };

  if (!item) return null;
  const overStock = qty > item.onHand;
  const valid = containerId && qty >= 1 && !overStock;

  const submit = () => {
    transfer.mutate(
      {
        fromType: LocationType.WAREHOUSE,
        fromId: warehouseId,
        toType: LocationType.CONTAINER,
        toId: containerId,
        items: [{ productId: item.productId, productName: item.productName, quantity: qty }],
      },
      { onSuccess: () => close(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Transfer to container</DialogTitle>
          <DialogDescription>
            Issue <b>{item.productName}</b> from this warehouse to a technician.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>To container</Label>
            <Select value={containerId} onValueChange={setContainerId}>
              <SelectTrigger className="h-10 w-full">
                <SelectValue placeholder="Pick a technician's container" />
              </SelectTrigger>
              <SelectContent>
                {list.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {containerLabel(c)}
                    {c.department ? (
                      <span className="text-muted-foreground"> · {c.department}</span>
                    ) : null}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {list.length === 0 ? (
              <p className="text-xs text-muted-foreground">No containers available.</p>
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
              Can&apos;t transfer more than on hand — the server rejects it.
            </div>
          ) : null}
        </div>

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">warehouse → container</span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              variant="brand"
              className="gap-1.5"
              disabled={!valid || transfer.isPending}
              onClick={submit}
            >
              {transfer.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Transfer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
