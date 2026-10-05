"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical, Loader2, Package, Plus, Trash2, Wrench } from "lucide-react";
import { ProductType, lineAmount } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/features/billing/lib";
import { CommitInput } from "@/features/billing/components/document-field";
import { ProductPickerDialog } from "@/features/billing/components/product-picker-dialog";
import { itemBodyFrom, reorderLineIds } from "@/features/estimates/lib";
import { estimateItemSchema, type EstimateItemBody } from "@/features/estimates/schemas";

/**
 * A line a document owns: an estimate's item, or a client invoice's (one with
 * no job — a job invoice's lines are the job's items and live on the job).
 */
export interface DocumentLineItem {
  lineId: string;
  position: number;
  productId: string;
  productType?: ProductType;
  name: string;
  sku: string;
  description?: string;
  quantity: number;
  priceClient: number;
  costCompany: number;
  costForTech: number;
  taxable: boolean;
}

export interface DocumentItemsTableProps {
  items: DocumentLineItem[];
  canEdit: boolean;
  /** What the empty table says ("No items on this estimate yet."). */
  emptyText: string;
  pending: { add: boolean; update: boolean; removingLineId?: string };
  onAdd: (body: EstimateItemBody, done: () => void) => void;
  onUpdate: (lineId: string, body: EstimateItemBody, done?: () => void) => void;
  onRemove: (lineId: string) => void;
  onReorder: (lineIds: string[]) => void;
  onTaxable: (lineId: string, taxable: boolean) => void;
  /** Buttons beside "Add item" (Workiz: Price book, Sync to Job …). */
  toolbar?: ReactNode;
  /** The page's own look for "Add item"; Workiz's yellow pill when left out. */
  addClassName?: string;
  /** Show the Cost column with the margin (staff who may see money). */
  showCost?: boolean;
}

const th = "px-3 py-2.5 text-left text-[13px] font-semibold";
const td = "px-3 py-3 align-top";

/**
 * The lines of a document that owns them, as Workiz lays its Items table out:
 * Item · Quantity · Price · Cost · Amount · Taxable, a drag handle on the
 * left, a bin on the right, the yellow "+ Add item" under it. Which document
 * — an estimate or a client invoice — is the wrapper's business.
 */
export function DocumentItemsTable({
  items,
  canEdit,
  emptyText,
  pending,
  onAdd,
  onUpdate,
  onRemove,
  onReorder,
  onTaxable,
  toolbar,
  addClassName = "rounded-pill px-4 font-semibold",
  showCost = true,
}: DocumentItemsTableProps) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<DocumentLineItem | null>(null);

  const sorted = useMemo(() => [...items].sort((a, b) => a.position - b.position), [items]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = sorted.map((i) => i.lineId);
    const next = reorderLineIds(ids, String(active.id), String(over.id));
    if (next !== ids) onReorder(next);
  };

  /** Inline qty/price edits go through the same validation as the dialog. */
  const saveInline = (item: DocumentLineItem, changes: { quantity?: string; priceClient?: string }) => {
    const parsed = estimateItemSchema.safeParse({ ...itemBodyFrom(item, {}), ...changes });
    if (!parsed.success) return;
    onUpdate(item.lineId, parsed.data);
  };

  const close = () => {
    setAdding(false);
    setEditing(null);
  };

  return (
    <div className="space-y-4">
      {sorted.length === 0 ? (
        <div className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <table className="w-full min-w-[40rem] border-separate border-spacing-0 text-sm">
              <thead>
                <tr className="text-foreground">
                  {canEdit ? <th className="w-8 border-b" aria-label="Reorder" /> : null}
                  <th className={cn(th, "border-b border-l border-dashed")}>Item</th>
                  <th className={cn(th, "w-28 border-b border-l border-dashed")}>Quantity</th>
                  <th className={cn(th, "w-32 border-b border-l border-dashed")}>Price</th>
                  {showCost ? <th className={cn(th, "w-36 border-b border-l border-dashed")}>Cost</th> : null}
                  <th className={cn(th, "w-32 border-b border-l border-dashed")}>Amount</th>
                  <th className={cn(th, "w-24 border-b border-l border-dashed")}>Taxable</th>
                  {canEdit ? <th className="w-12 border-b border-l border-dashed" aria-label="Remove" /> : null}
                </tr>
              </thead>
              <SortableContext items={sorted.map((i) => i.lineId)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {sorted.map((item) => (
                    <ItemRow
                      key={item.lineId}
                      item={item}
                      canEdit={canEdit}
                      showCost={showCost}
                      removing={pending.removingLineId === item.lineId}
                      onEdit={() => setEditing(item)}
                      onRemove={() => onRemove(item.lineId)}
                      onTaxable={(taxable) => onTaxable(item.lineId, taxable)}
                      onInline={(changes) => saveInline(item, changes)}
                    />
                  ))}
                </tbody>
              </SortableContext>
            </table>
          </DndContext>
        </div>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="default" size="lg" className={addClassName} onClick={() => setAdding(true)}>
            <Plus /> Add item
          </Button>
          {toolbar}
        </div>
      ) : null}

      <ProductPickerDialog
        open={adding || editing !== null}
        onOpenChange={(v) => {
          if (!v) close();
        }}
        editing={editing ?? undefined}
        pending={pending.add || pending.update}
        onSubmit={(body) => {
          if (editing) onUpdate(editing.lineId, body, close);
          else onAdd(body, close);
        }}
      />
    </div>
  );
}

/** Cost → margin, as Workiz prints under the cost ("71.32 Margin" = percent of the price kept). */
export function marginPercent(priceClient: number, costCompany: number): number | null {
  if (!(priceClient > 0)) return null;
  return Math.round(((priceClient - costCompany) / priceClient) * 10000) / 100;
}

function ItemRow({
  item,
  canEdit,
  showCost,
  removing,
  onEdit,
  onRemove,
  onTaxable,
  onInline,
}: {
  item: DocumentLineItem;
  canEdit: boolean;
  showCost: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onTaxable: (taxable: boolean) => void;
  onInline: (changes: { quantity?: string; priceClient?: string }) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.lineId, disabled: !canEdit });
  const isService = item.productType === ProductType.SERVICE;
  const margin = marginPercent(item.priceClient, item.costCompany);
  const cell = cn(td, "border-b border-l border-dashed");

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("bg-background", isDragging && "relative z-10 opacity-80 shadow-sm")}
    >
      {canEdit ? (
        <td className="border-b pl-1 align-top pt-3">
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${item.name}`}
            className="flex cursor-grab touch-none items-center rounded p-1 text-muted-foreground hover:bg-muted active:cursor-grabbing"
          >
            <GripVertical className="size-4" />
          </button>
        </td>
      ) : null}
      <td className={cell}>
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-10 flex-none items-center justify-center rounded-md border bg-muted/40 text-muted-foreground",
              isService && "bg-info/10 text-info-text",
            )}
          >
            {isService ? <Wrench className="size-4" /> : <Package className="size-4" />}
          </span>
          <div className="min-w-0">
            {canEdit ? (
              <button type="button" onClick={onEdit} className="text-left font-medium hover:underline" aria-label={`Edit ${item.name}`}>
                {item.name}
              </button>
            ) : (
              <span className="font-medium">{item.name}</span>
            )}
            {item.description ? (
              <p className="mt-0.5 line-clamp-2 text-xs whitespace-pre-line text-muted-foreground">{item.description}</p>
            ) : null}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {item.sku ? <span className="font-mono text-[11px] text-muted-foreground">{item.sku}</span> : null}
              {isService ? (
                <span className="rounded-chip border border-info/40 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-info-text uppercase">
                  Service
                </span>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td className={cn(cell, "tabular-nums")}>
        {canEdit ? (
          <CommitInput
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            aria-label={`${item.name} quantity`}
            value={String(item.quantity)}
            onCommit={(quantity) => onInline({ quantity })}
            className="h-8 w-20 tabular-nums"
          />
        ) : (
          item.quantity.toFixed(2)
        )}
      </td>
      <td className={cn(cell, "font-mono tabular-nums")}>
        {canEdit ? (
          <CommitInput
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            aria-label={`${item.name} price`}
            value={String(item.priceClient)}
            onCommit={(priceClient) => onInline({ priceClient })}
            className="h-8 w-28 font-mono tabular-nums"
          />
        ) : (
          formatMoney(item.priceClient)
        )}
      </td>
      {showCost ? (
        <td className={cn(cell, "font-mono tabular-nums")}>
          {formatMoney(item.costCompany)}
          {margin !== null ? (
            <span className="mt-1 block w-fit rounded-md border px-1.5 py-0.5 font-sans text-[11px] text-muted-foreground">
              {margin}% margin
            </span>
          ) : null}
        </td>
      ) : null}
      <td className={cn(cell, "font-mono tabular-nums")}>{formatMoney(lineAmount(item))}</td>
      <td className={cell}>
        <label className="inline-flex items-center gap-2">
          <Checkbox
            checked={item.taxable !== false}
            disabled={!canEdit}
            onCheckedChange={(v) => onTaxable(v === true)}
            aria-label={`${item.name} is taxable`}
          />
          <span className="text-sm">{item.taxable !== false ? "Yes" : "No"}</span>
        </label>
      </td>
      {canEdit ? (
        <td className={cn(cell, "text-center")}>
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${item.name}`}
          >
            {removing ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
          </button>
        </td>
      ) : null}
    </tr>
  );
}
