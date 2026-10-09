"use client";

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ReturnReason } from "@bitcrm/types";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { WzButton } from "@/components/workiz/button";
import { cn } from "@/lib/utils";
import { RETURN_REASON_LABELS } from "@/features/inventory/transfers/lib";
import { useAllLocations, useMoveStock, useReceiveStock, useReturnStock } from "../hooks";
import { checkQuantity, moveTargets, type StockLocation, type StockTarget } from "../lib";
import { LocationPicker } from "./location-picker";

/**
 * The three small dialogs over a stock list — Workiz's "Add items", "Move
 * items to container" and "Item return" (stockOptionsModals-module,
 * pg_inventory_wz_08/09/10): 440px, 16px corners, 24px in, the h4 title, the
 * outlined 40px fields with their placeholders, Cancel and the yellow Save at
 * the bottom right. Each takes one item in one location, so the item's popup
 * (rows are locations) and a location's popup (rows are items) open the same
 * ones. BitCRM keeps what Workiz lacks: the reason list of a return and a
 * note on every movement.
 *
 * Mount them only while open: a fresh mount is a fresh form.
 */
interface ActionProps {
  target: StockTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Workiz's Input-module box: 40px, 1px #9ea6aa, 4px corners, 13px ink 12px in. */
const FIELD =
  "h-10 w-full rounded-[4px] border border-wz-outline bg-background px-3 text-[13px] leading-4 text-foreground outline-none placeholder:text-wz-outline-label hover:border-foreground focus:border-wz-link aria-invalid:border-wz-error";

/** Into this location, from the supplier. No ceiling: nothing here is taken. */
export function AddStockDialog({ target, open, onOpenChange }: ActionProps) {
  const receive = useReceiveStock();
  const qty = useQuantity();
  const [notes, setNotes] = useState("");

  const submit = () => {
    if (qty.quantity === null) return;
    receive.mutate(
      withNotes(
        { toType: target.location.type, toId: target.location.id, items: itemsOf(target, qty.quantity) },
        notes,
      ),
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ActionDialog
      title="Add items"
      target={target}
      open={open}
      onOpenChange={onOpenChange}
      canSubmit={qty.quantity !== null}
      pending={receive.isPending}
      onSubmit={submit}
    >
      <QuantityField qty={qty} hint="How many items would you like to add?" />
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
  // Radix may call an Escape handler from an earlier render; a ref is always current.
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
        { fromType: type, fromId: id, toType: to.type, toId: to.id, items: itemsOf(target, qty.quantity) },
        notes,
      ),
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ActionDialog
      title="Move items to container"
      target={target}
      open={open}
      onOpenChange={onOpenChange}
      // Escape in the open list closes the list, not the dialog.
      onEscapeKeyDown={(e) => {
        if (!pickingRef.current) return;
        e.preventDefault();
        setPicking(false);
      }}
      canSubmit={qty.quantity !== null && !!to}
      pending={move.isPending}
      onSubmit={submit}
    >
      {/* Workiz's two labelled steps: "Move" (how many) and "To" (where). */}
      <div className="flex flex-col gap-2">
        <p className="text-sm leading-[21px] font-semibold text-foreground">Move</p>
        <QuantityField qty={qty} hint={`${target.available} in ${target.location.name}`} />
      </div>
      <div className="flex flex-col gap-2">
        <p id={labelId} aria-label="To location" className="text-sm leading-[21px] font-semibold text-foreground">
          To
        </p>
        <LocationPicker
          labelId={labelId}
          look="workiz"
          placeholder="Container"
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

  const submit = () => {
    if (qty.quantity === null || !reason) return;
    ret.mutate(
      withNotes(
        { fromType: target.location.type, fromId: target.location.id, items: itemsOf(target, qty.quantity), reason },
        notes,
      ),
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <ActionDialog
      title="Item return"
      target={target}
      open={open}
      onOpenChange={onOpenChange}
      canSubmit={qty.quantity !== null && !!reason}
      pending={ret.isPending}
      onSubmit={submit}
    >
      <QuantityField qty={qty} hint="Enter the quantity you wish to return" hintTone="ink" />
      {/* BitCRM's reasons (the owner's list) — Workiz only has the free text under it. */}
      <Select value={reason} onValueChange={(v) => setReason(v as ReturnReason)}>
        <SelectTrigger
          aria-label="Reason"
          className="h-10 w-full rounded-[4px] border-wz-outline text-[13px] data-placeholder:text-wz-outline-label"
        >
          <SelectValue placeholder="Reason" />
        </SelectTrigger>
        <SelectContent>
          {REASONS.map((r) => (
            <SelectItem key={r} value={r}>
              {RETURN_REASON_LABELS[r]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <NotesField value={notes} onChange={setNotes} placeholder="Return reason" />
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
  // Empty, its placeholder showing — Workiz's "Quantity" box; Save waits for a number.
  const [raw, setRaw] = useState("");
  return { raw, setRaw, max, ...checkQuantity(raw, max) };
}

/**
 * Workiz's Quantity box with the line under it: its helper ("How many items
 * would you like to add?", 11px #768287; the return's 12px ink one) or, when
 * the number won't do, why (Workiz's #e35a36).
 */
function QuantityField({ qty, hint, hintTone = "muted" }: { qty: Quantity; hint?: string; hintTone?: "muted" | "ink" }) {
  const id = useId();
  const hintId = `${id}-hint`;
  return (
    <div className="flex flex-col">
      <input
        id={id}
        type="text"
        inputMode="numeric"
        aria-label="Quantity"
        placeholder="Quantity"
        min={1}
        max={qty.max}
        step={1}
        value={qty.raw}
        onChange={(e) => qty.setRaw(e.target.value)}
        aria-invalid={qty.error ? true : undefined}
        aria-describedby={qty.error || hint ? hintId : undefined}
        className={cn(FIELD, "tabular-nums")}
      />
      {qty.error ? (
        <p id={hintId} className="mt-1 pl-px text-[11px] leading-4 text-wz-error">
          {qty.error}
        </p>
      ) : hint ? (
        <p
          id={hintId}
          className={cn(
            "pl-px",
            hintTone === "ink" ? "text-xs leading-[18px] text-foreground" : "mt-1 text-[11px] leading-4 text-wz-outline-label",
          )}
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A note on the movement — Workiz's "Return reason" box (96px, 13px, placeholder inside). */
function NotesField({
  value,
  onChange,
  placeholder = "Notes (optional)",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <textarea
      aria-label="Notes (optional)"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={4}
      className="h-24 w-full resize-y rounded-[4px] border border-wz-outline bg-background px-3 py-[10.5px] text-[13px] leading-4 text-foreground outline-none placeholder:text-wz-outline-label hover:border-foreground focus:border-wz-link"
    />
  );
}

function ActionDialog({
  title,
  target,
  open,
  onOpenChange,
  onEscapeKeyDown,
  canSubmit,
  pending,
  onSubmit,
  children,
}: {
  title: string;
  target: StockTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEscapeKeyDown?: (e: KeyboardEvent) => void;
  canSubmit: boolean;
  pending: boolean;
  onSubmit: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[440px] gap-0 sm:max-w-[440px]" onEscapeKeyDown={onEscapeKeyDown}>
        <form
          className="flex flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit && !pending) onSubmit();
          }}
        >
          {/* The h4, 25px over the first field; × at the right. */}
          <DialogTitle className="pr-8">{title}</DialogTitle>
          {/* Workiz's popup says nothing of which item and where — the row it was opened from does. */}
          <DialogDescription className="sr-only">
            {target.product.name} — {target.location.name}
          </DialogDescription>
          <div className="mt-[25px] flex flex-col gap-6">{children}</div>
          <div className="mt-12 flex justify-end gap-4">
            <WzButton variant="tertiary" size="big" onClick={() => onOpenChange(false)}>
              Cancel
            </WzButton>
            <WzButton type="submit" variant="primary" size="big" disabled={!canSubmit} loading={pending}>
              Save
            </WzButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
