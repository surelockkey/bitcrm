"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { ReturnReason } from "@bitcrm/types";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RETURN_REASON_LABELS } from "@/features/inventory/transfers/lib";
import { useAllLocations, useMoveStock, useReceiveStock, useReturnStock } from "../hooks";
import { checkQuantity, moveTargets, type StockLocation, type StockTarget } from "../lib";
import { LocationPicker } from "./location-picker";

/**
 * The three small dialogs over a stock list — Workiz's ＋ / Move / Return.
 * Each takes one item in one location, so the item's popup (rows are
 * locations) and a location's popup (rows are items) open the same ones.
 *
 * Mount them only while open: a fresh mount is a fresh form.
 */
interface ActionProps {
  target: StockTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Into this location, from the supplier. No ceiling: nothing here is taken. */
export function AddStockDialog({ target, open, onOpenChange }: ActionProps) {
  const receive = useReceiveStock();
  const qty = useQuantity();
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (qty.quantity === null) return;
    receive.mutate(
      withNotes(
        {
          toType: target.location.type,
          toId: target.location.id,
          items: itemsOf(target, qty.quantity),
        },
        notes,
      ),
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ActionDialog
      title={`Add ${target.product.name} to ${target.location.name}`}
      description="New stock arriving from a supplier."
      open={open}
      onOpenChange={onOpenChange}
      submitLabel="Add stock"
      canSubmit={qty.quantity !== null}
      pending={receive.isPending}
      onSubmit={submit}
    >
      <QuantityField qty={qty} />
      <NotesField value={notes} onChange={setNotes} />
    </ActionDialog>
  );
}

/** From this location to any other one — a van to a van, a van back to a warehouse. */
export function MoveStockDialog({ target, open, onOpenChange }: ActionProps) {
  const move = useMoveStock();
  const locations = useAllLocations(open);
  const qty = useQuantity(target.available);
  const [to, setTo] = useState<StockLocation | null>(null);
  const [picking, setPicking] = useState(false);
  const [notes, setNotes] = useState("");
  const labelId = useId();
  // Radix may call an Escape handler from an earlier render; a ref is
  // always current.
  const pickingRef = useRef(picking);
  useEffect(() => {
    pickingRef.current = picking;
  }, [picking]);

  const { type, id } = target.location;
  const groups = useMemo(() => moveTargets(locations.data, { type, id }), [locations.data, type, id]);

  const submit = () => {
    if (qty.quantity === null || !to) return;
    move.mutate(
      withNotes(
        {
          fromType: type,
          fromId: id,
          toType: to.type,
          toId: to.id,
          items: itemsOf(target, qty.quantity),
        },
        notes,
      ),
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ActionDialog
      title={`Move ${target.product.name} from ${target.location.name}`}
      description="To another warehouse or van."
      open={open}
      onOpenChange={onOpenChange}
      // Escape in the open list closes the list, not the dialog.
      onEscapeKeyDown={(e) => {
        if (!pickingRef.current) return;
        e.preventDefault();
        setPicking(false);
      }}
      submitLabel="Move"
      canSubmit={qty.quantity !== null && !!to}
      pending={move.isPending}
      onSubmit={submit}
    >
      <div className="space-y-1.5">
        <Label id={labelId}>To location</Label>
        <LocationPicker
          labelId={labelId}
          groups={groups}
          value={to}
          onChange={(l) => {
            setTo(l);
            setPicking(false);
          }}
          open={picking}
          onOpenChange={setPicking}
          loading={locations.isLoading}
        />
      </div>
      <QuantityField qty={qty} hint={`${target.available} in ${target.location.name}`} />
      <NotesField value={notes} onChange={setNotes} />
    </ActionDialog>
  );
}

const REASONS = Object.values(ReturnReason);

/** Out of stock for good, with why: recalled, damaged, lost. */
export function ReturnStockDialog({ target, open, onOpenChange }: ActionProps) {
  const ret = useReturnStock();
  const qty = useQuantity(target.available);
  const [reason, setReason] = useState<ReturnReason | "">("");
  const [notes, setNotes] = useState("");
  const labelId = useId();

  const submit = () => {
    if (qty.quantity === null || !reason) return;
    ret.mutate(
      withNotes(
        {
          fromType: target.location.type,
          fromId: target.location.id,
          items: itemsOf(target, qty.quantity),
          reason,
        },
        notes,
      ),
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ActionDialog
      title={`Return ${target.product.name} from ${target.location.name}`}
      description="Takes the stock out — recalled, damaged or lost."
      open={open}
      onOpenChange={onOpenChange}
      submitLabel="Return"
      canSubmit={qty.quantity !== null && !!reason}
      pending={ret.isPending}
      onSubmit={submit}
    >
      <QuantityField qty={qty} hint={`${target.available} in ${target.location.name}`} />
      <div className="space-y-1.5">
        <Label id={labelId}>Reason</Label>
        <Select value={reason} onValueChange={(v) => setReason(v as ReturnReason)}>
          <SelectTrigger className="h-10 w-full" aria-labelledby={labelId}>
            <SelectValue placeholder="Pick a reason" />
          </SelectTrigger>
          <SelectContent>
            {REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {RETURN_REASON_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <NotesField value={notes} onChange={setNotes} />
    </ActionDialog>
  );
}

/* ------------------------------------------------------------------ */

function itemsOf(target: StockTarget, quantity: number) {
  return [{ productId: target.product.id, productName: target.product.name, quantity }];
}

/** Blank notes stay out of the body instead of arriving as "". */
function withNotes<B extends object>(body: B, notes: string): B & { notes?: string } {
  const text = notes.trim();
  return text ? { ...body, notes: text } : body;
}

type Quantity = ReturnType<typeof useQuantity>;

function useQuantity(max?: number) {
  const [raw, setRaw] = useState("1");
  return { raw, setRaw, max, ...checkQuantity(raw, max) };
}

function QuantityField({ qty, hint }: { qty: Quantity; hint?: string }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Quantity</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        max={qty.max}
        step={1}
        value={qty.raw}
        onChange={(e) => qty.setRaw(e.target.value)}
        aria-invalid={qty.error ? true : undefined}
        aria-describedby={qty.error || hint ? hintId : undefined}
        className="h-10 w-32 tabular-nums"
      />
      {qty.error ? (
        <p id={hintId} className="text-xs text-destructive">
          {qty.error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function NotesField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const id = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        Notes <span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={2} />
    </div>
  );
}

function ActionDialog({
  title,
  description,
  open,
  onOpenChange,
  onEscapeKeyDown,
  submitLabel,
  canSubmit,
  pending,
  onSubmit,
  children,
}: {
  title: string;
  description: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  submitLabel: string;
  canSubmit: boolean;
  pending: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onEscapeKeyDown={onEscapeKeyDown}>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !pending) onSubmit();
          }}
        >
          {/* Right padding keeps a long title clear of the close button. */}
          <DialogHeader className="pr-8">
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" className="gap-1.5" disabled={!canSubmit || pending}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
