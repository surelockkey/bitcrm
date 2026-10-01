"use client";

import { useMemo, useState } from "react";
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
import { GripVertical, Loader2, Plus, X } from "lucide-react";
import { lineAmount, type ProductType } from "@bitcrm/types";
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
}

/**
 * The lines of a document that owns them, with drag-to-reorder, inline
 * qty/price edits and the catalog picker. Which document — an estimate or a
 * client invoice — is the wrapper's business: it brings the mutations.
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
    <div className="space-y-3">
      {sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">{emptyText}</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            modifiers={[restrictToVerticalAxis, restrictToParentElement]}
            onDragEnd={onDragEnd}
          >
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b bg-muted/40 text-xs tracking-wide text-muted-foreground uppercase">
                  {canEdit ? <th className="w-7" aria-label="Reorder" /> : null}
                  <th className="px-3 py-2 text-left font-semibold">Item</th>
                  <th className="w-20 px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="w-28 px-2 py-2 text-right font-semibold">Price</th>
                  <th className="px-3 py-2 text-right font-semibold">Amount</th>
                  <th className="px-2 py-2 text-center font-semibold">Taxable</th>
                  {canEdit ? <th className="w-8" /> : null}
                </tr>
              </thead>
              <SortableContext items={sorted.map((i) => i.lineId)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {sorted.map((item) => (
                    <ItemRow
                      key={item.lineId}
                      item={item}
                      canEdit={canEdit}
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
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="size-3.5" /> Add item
        </Button>
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

function ItemRow({
  item,
  canEdit,
  removing,
  onEdit,
  onRemove,
  onTaxable,
  onInline,
}: {
  item: DocumentLineItem;
  canEdit: boolean;
  removing: boolean;
  onEdit: () => void;
  onRemove: () => void;
  onTaxable: (taxable: boolean) => void;
  onInline: (changes: { quantity?: string; priceClient?: string }) => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: item.lineId, disabled: !canEdit });

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("border-b bg-background last:border-0", isDragging && "relative z-10 opacity-80 shadow-sm")}
    >
      {canEdit ? (
        <td className="pl-1.5 align-middle">
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
      <td className="px-3 py-2">
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
        <div className="font-mono text-[11px] text-muted-foreground">{item.sku}</div>
      </td>
      <td className="px-2 py-2 text-right tabular-nums">
        {canEdit ? (
          <CommitInput
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            aria-label={`${item.name} quantity`}
            value={String(item.quantity)}
            onCommit={(quantity) => onInline({ quantity })}
            className="h-7 text-right tabular-nums"
          />
        ) : (
          item.quantity
        )}
      </td>
      <td className="px-2 py-2 text-right font-mono tabular-nums">
        {canEdit ? (
          <CommitInput
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            aria-label={`${item.name} price`}
            value={String(item.priceClient)}
            onCommit={(priceClient) => onInline({ priceClient })}
            className="h-7 text-right font-mono tabular-nums"
          />
        ) : (
          formatMoney(item.priceClient)
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums">{formatMoney(lineAmount(item))}</td>
      <td className="px-2 py-2 text-center">
        <Checkbox
          checked={item.taxable !== false}
          disabled={!canEdit}
          onCheckedChange={(v) => onTaxable(v === true)}
          aria-label={`${item.name} is taxable`}
        />
      </td>
      {canEdit ? (
        <td className="px-2 py-2 text-right">
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className="text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${item.name}`}
          >
            {removing ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          </button>
        </td>
      ) : null}
    </tr>
  );
}
