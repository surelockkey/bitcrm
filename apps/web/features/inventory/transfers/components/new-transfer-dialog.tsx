"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Loader2, Plus, Search, X } from "lucide-react";
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
import { useWarehouses, useContainers, useCreateTransfer } from "@/features/inventory/warehouses/hooks";
import { containerLabel } from "@/features/inventory/warehouses/lib";
import { getWarehouseStock } from "@/features/inventory/warehouses/api";
import { getContainerStock } from "@/features/inventory/containers/api";

type Loc = { id: string; label: string; kind: "warehouse" | "container" };
interface Row { productId: string; productName: string; onHand: number; quantity: number }

export function NewTransferDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: warehouses } = useWarehouses();
  const { data: containers } = useContainers(open);
  const create = useCreateTransfer();

  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState("");
  const [notes, setNotes] = useState("");

  const locations: Loc[] = useMemo(
    () => [
      ...(warehouses?.data ?? []).map((w) => ({ id: w.id, label: w.name, kind: "warehouse" as const })),
      ...(containers?.data ?? []).map((c) => ({
        id: c.id,
        label: containerLabel(c) + (c.department ? ` · ${c.department}` : ""),
        kind: "container" as const,
      })),
    ],
    [warehouses, containers],
  );
  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const from = fromId ? byId.get(fromId) : undefined;

  // Valid routes: warehouse→container, container→warehouse, container→container.
  const toOptions = locations.filter((l) => {
    if (!from || l.id === fromId) return false;
    if (from.kind === "warehouse") return l.kind === "container";
    return true;
  });

  // Products come from the source's own stock.
  const stockQ = useQuery({
    queryKey: ["transfer-source-stock", from?.kind, fromId],
    queryFn: () =>
      from!.kind === "warehouse" ? getWarehouseStock(fromId) : getContainerStock(fromId),
    enabled: open && !!from,
  });
  const sourceStock = (stockQ.data ?? []).filter((s) => s.quantity > 0);
  const chosen = new Set(rows.map((r) => r.productId));
  const matches = search
    ? sourceStock
        .filter((s) => !chosen.has(s.productId))
        .filter((s) => s.productName.toLowerCase().includes(search.toLowerCase()))
        .slice(0, 6)
    : [];

  const reset = () => {
    setFromId("");
    setToId("");
    setRows([]);
    setSearch("");
    setNotes("");
  };
  const close = (o: boolean) => {
    if (!o) reset();
    onOpenChange(o);
  };
  const changeFrom = (id: string) => {
    setFromId(id);
    setToId("");
    setRows([]);
  };

  const addProduct = (s: { productId: string; productName: string; quantity: number }) => {
    setRows((r) => [...r, { productId: s.productId, productName: s.productName, onHand: s.quantity, quantity: 1 }]);
    setSearch("");
  };
  const setQty = (id: string, q: number) => setRows((r) => r.map((row) => (row.productId === id ? { ...row, quantity: q } : row)));
  const remove = (id: string) => setRows((r) => r.filter((row) => row.productId !== id));

  const units = rows.reduce((n, r) => n + (r.quantity || 0), 0);
  const valid =
    from && toId && rows.length > 0 && rows.every((r) => r.quantity >= 1 && r.quantity <= r.onHand);

  const submit = () => {
    const to = byId.get(toId);
    if (!from || !to) return;
    create.mutate(
      {
        fromType: from.kind === "warehouse" ? LocationType.WAREHOUSE : LocationType.CONTAINER,
        fromId,
        toType: to.kind === "warehouse" ? LocationType.WAREHOUSE : LocationType.CONTAINER,
        toId,
        items: rows.map((r) => ({ productId: r.productId, productName: r.productName, quantity: r.quantity })),
        notes: notes || undefined,
      },
      { onSuccess: () => close(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New transfer</DialogTitle>
          <DialogDescription>
            Move stock between a warehouse and a technician&apos;s container.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
          <div className="space-y-1.5">
            <Label>From</Label>
            <Select value={fromId} onValueChange={changeFrom}>
              <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Source" /></SelectTrigger>
              <SelectContent>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ArrowRight className="mb-3 size-4 text-muted-foreground" />
          <div className="space-y-1.5">
            <Label>To</Label>
            <Select value={toId} onValueChange={setToId} disabled={!from}>
              <SelectTrigger className="h-10 w-full"><SelectValue placeholder="Destination" /></SelectTrigger>
              <SelectContent>
                {toOptions.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {from ? (
          <div className="relative">
            <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Add a product from the source's stock…"
              className="h-10 pl-8"
            />
            {matches.length > 0 ? (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
                {matches.map((s) => (
                  <button
                    key={s.productId}
                    type="button"
                    onClick={() => addProduct(s)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Plus className="size-3.5 text-muted-foreground" />
                    <span className="flex-1 truncate">{s.productName}</span>
                    <span className="font-mono text-xs text-muted-foreground">on hand {s.quantity}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}

        {rows.length > 0 ? (
          <div className="max-h-56 divide-y overflow-y-auto rounded-lg border">
            {rows.map((r) => (
              <div key={r.productId} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 truncate">{r.productName}</span>
                <span className="font-mono text-[11px] text-muted-foreground">on hand {r.onHand}</span>
                <Input
                  type="number"
                  min={1}
                  max={r.onHand}
                  value={r.quantity}
                  onChange={(e) => setQty(r.productId, Number(e.target.value))}
                  className="h-8 w-20 text-center tabular-nums"
                />
                <Button variant="ghost" size="icon" className="size-7" onClick={() => remove(r.productId)}>
                  <X className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : from ? (
          <p className="rounded-lg border border-dashed px-3 py-5 text-center text-sm text-muted-foreground">
            {stockQ.isLoading ? "Loading source stock…" : "Add products to move."}
          </p>
        ) : null}

        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" className="h-9" />

        <DialogFooter className="items-center sm:justify-between">
          <span className="text-xs text-muted-foreground">
            {rows.length} {rows.length === 1 ? "product" : "products"} · {units} units
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
            <Button variant="brand" className="gap-1.5" disabled={!valid || create.isPending} onClick={submit}>
              {create.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              Create transfer
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
