"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
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
import { GripVertical, ImageIcon, Loader2, Plus, Trash2 } from "lucide-react";
import { ProductType, lineAmount } from "@bitcrm/types";
import { WzButton } from "@/components/workiz/button";
import { cn } from "@/lib/utils";
import { formatMoney } from "@/features/billing/lib";
import { ProductPickerDialog } from "@/features/billing/components/product-picker-dialog";
import { ItemsArt } from "@/features/deals/components/job-empty-art";
import { itemBodyFrom, reorderLineIds } from "@/features/estimates/lib";
import { estimateItemSchema } from "@/features/estimates/schemas";
import type { DocumentItemsTableProps, DocumentLineItem } from "./document-items-table";
import { marginPercent } from "./document-items-table";

/*
 * Workiz's Items grid on a document page (pg_estimate_wz_01_job,
 * pg_estimate_wz_02_client; main.css `items-module`): 47px bold heads, cells
 * 15px 10px 15px 15px, dotted #cfcfcf rules down and a solid #e6e6e6 one under
 * each line, the 56px grip column, Quantity / Price / Cost / Amount / Taxable
 * 126px, the sticky white Actions column with the bin, #f0f0f0 under the cursor.
 */
const TH = "h-[47px] border-r border-b border-dotted border-[#cfcfcf] py-[15px] pr-2.5 pl-[15px] text-left text-[14px] leading-4 font-bold";
const TD =
  "border-r border-b border-r-[#cfcfcf] border-b-[#e6e6e6] [border-right-style:dotted] py-[15px] pr-2.5 pl-[15px] align-top text-[14px] leading-4";
/** The item's tags under its words: 10px capitals, r10, 0 8px (SERVICE outlined blue, TAXABLE filled #d574e4). */
const TAG = "inline-flex h-[18px] items-center rounded-[10px] border px-2 text-[10px] leading-4 uppercase";

/**
 * The lines of a document in Workiz's dress. Words at rest, as Workiz prints
 * them ("1.00", "$912.17", "Yes"); a click on the quantity or the price turns
 * it into a box (Enter or leaving saves, Escape keeps it), a click on the
 * Taxable word flips it, the name (or the row) opens the line in the item
 * window, the grip reorders. Then "+ Add item" and the page's own buttons.
 */
export function WorkizDocumentItems({
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

  /** In-place qty/price edits go through the same validation as the item window. */
  const saveInline = (item: DocumentLineItem, changes: { quantity?: string; priceClient?: string }) => {
    const parsed = estimateItemSchema.safeParse({ ...itemBodyFrom(item, {}), ...changes });
    if (!parsed.success) return;
    onUpdate(item.lineId, parsed.data);
  };

  const close = () => {
    setAdding(false);
    setEditing(null);
  };

  const withActions = canEdit && sorted.length > 0;

  return (
    <div className="text-wz-strong">
      <div className="mt-5 overflow-x-auto">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
        >
          <table className="w-full min-w-[52rem] table-fixed border-separate border-spacing-0">
            <thead>
              <tr>
                <th className={cn(TH, "w-[56px]")} aria-label={canEdit ? "Reorder" : undefined} />
                <th className={TH}>Item</th>
                <th className={cn(TH, "w-[126px]")}>Quantity</th>
                <th className={cn(TH, "w-[126px]")}>Price</th>
                {showCost ? <th className={cn(TH, "w-[126px]")}>Cost</th> : null}
                <th className={cn(TH, "w-[126px]")}>Amount</th>
                <th className={cn(TH, sorted.length ? "w-[126px]" : "w-[126px] border-r-0")}>Taxable</th>
                {withActions ? (
                  <th className={cn(TH, "sticky right-0 w-[84px] border-r-0 border-l bg-white")}>Actions</th>
                ) : null}
              </tr>
            </thead>
            {sorted.length > 0 ? (
              <SortableContext items={sorted.map((i) => i.lineId)} strategy={verticalListSortingStrategy}>
                <tbody>
                  {sorted.map((item) => (
                    <WorkizItemRow
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
            ) : null}
          </table>
        </DndContext>
      </div>

      {sorted.length === 0 ? (
        // Workiz's empty grid: the art and "Add items" in a 232px band under the heads.
        <div className="flex h-[232px] flex-col items-center justify-end gap-1 border-b border-[#e6e6e6] pb-[13px]">
          <ItemsArt />
          {canEdit ? (
            <button type="button" onClick={() => setAdding(true)} className="text-[16px] leading-[19px] text-wz-strong hover:underline">
              Add items
            </button>
          ) : (
            <span className="text-[16px] leading-[19px]">{emptyText}</span>
          )}
        </div>
      ) : null}

      {canEdit || toolbar ? (
        <div className="mt-5 flex flex-wrap items-center gap-2.5">
          {canEdit ? (
            <WzButton size="regular" icon={<Plus strokeWidth={1.75} />} className="h-[34px]" onClick={() => setAdding(true)}>
              Add item
            </WzButton>
          ) : null}
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

function WorkizItemRow({
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
  const taxable = item.taxable !== false;
  const margin = marginPercent(item.priceClient, item.costCompany);
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={canEdit ? onEdit : undefined}
      className={cn(
        "bg-white transition-colors",
        canEdit && "cursor-pointer hover:bg-[#f0f0f0]",
        isDragging && "relative z-10 opacity-80 shadow-sm",
      )}
    >
      <td className={cn(TD, "text-center")} onClick={stop}>
        {canEdit ? (
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${item.name}`}
            className="mx-auto flex cursor-grab touch-none items-center rounded-[4px] p-0.5 text-wz-caption hover:bg-wz-secondary-hover active:cursor-grabbing"
          >
            <GripVertical className="size-4" strokeWidth={1.5} />
          </button>
        ) : null}
      </td>
      <td className={TD}>
        <div className="flex items-start gap-[18px]">
          <span
            aria-hidden
            className="flex size-[58px] flex-none items-center justify-center rounded-[8px] border border-wz-rule bg-white text-wz-outline"
          >
            <ImageIcon className="size-6" strokeWidth={1.25} />
          </span>
          <div className="min-w-0">
            {canEdit ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEdit();
                }}
                className="text-left hover:underline"
                aria-label={`Edit ${item.name}`}
                title={item.sku || undefined}
              >
                {item.name}
              </button>
            ) : (
              <span title={item.sku || undefined}>{item.name}</span>
            )}
            {item.description ? (
              <p className="mt-[5px] break-words whitespace-break-spaces text-wz-text">{item.description}</p>
            ) : null}
            {isService || taxable ? (
              <div className="mt-2.5 flex flex-wrap gap-x-2 gap-y-1">
                {isService ? <span className={cn(TAG, "border-wz-link text-wz-link")}>Service</span> : null}
                {taxable ? <span className={cn(TAG, "border-[#d574e4] bg-[#d574e4] text-white")}>Taxable</span> : null}
              </div>
            ) : null}
          </div>
        </div>
      </td>
      <td className={cn(TD, "tabular-nums")} onClick={canEdit ? stop : undefined}>
        <CellEditor
          canEdit={canEdit}
          label={`${item.name} quantity`}
          value={String(item.quantity)}
          display={item.quantity.toFixed(2)}
          inputMode="numeric"
          step={1}
          min={1}
          onCommit={(quantity) => onInline({ quantity })}
        />
      </td>
      <td className={cn(TD, "tabular-nums")} onClick={canEdit ? stop : undefined}>
        <CellEditor
          canEdit={canEdit}
          label={`${item.name} price`}
          value={String(item.priceClient)}
          display={formatMoney(item.priceClient)}
          inputMode="decimal"
          step="0.01"
          min={0}
          onCommit={(priceClient) => onInline({ priceClient })}
        />
      </td>
      {showCost ? (
        <td className={cn(TD, "tabular-nums")}>
          {formatMoney(item.costCompany)}
          {margin !== null ? <span className="mt-[5px] block text-[12px] leading-4 text-wz-caption">{margin}% margin</span> : null}
        </td>
      ) : null}
      <td className={cn(TD, "tabular-nums")}>{formatMoney(lineAmount(item))}</td>
      <td className={cn(TD, !canEdit && "border-r-0")} onClick={stop}>
        {/* Workiz prints the word; ours flips it on a click, the box kept for screen readers. */}
        <label className={cn("inline-flex", canEdit ? "cursor-pointer hover:underline" : "cursor-default")}>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={taxable}
            disabled={!canEdit}
            onChange={(e) => onTaxable(e.target.checked)}
            aria-label={`${item.name} is taxable`}
          />
          <span className="rounded-[2px] peer-focus-visible:ring-2 peer-focus-visible:ring-wz-focus">{taxable ? "Yes" : "No"}</span>
        </label>
      </td>
      {canEdit ? (
        <td className={cn(TD, "sticky right-0 border-r-0 border-l border-l-[#cfcfcf] [border-left-style:dotted] bg-white align-middle")} onClick={stop}>
          <button
            type="button"
            onClick={onRemove}
            disabled={removing}
            className="grid size-8 place-items-center rounded-[8px] text-foreground hover:bg-wz-secondary-hover hover:text-wz-danger disabled:opacity-50"
            aria-label={`Remove ${item.name}`}
          >
            {removing ? <Loader2 className="size-5 animate-spin" /> : <Trash2 className="size-5" strokeWidth={1.25} />}
          </button>
        </td>
      ) : null}
    </tr>
  );
}

/**
 * A number printed as Workiz prints it that becomes a box when clicked:
 * Enter or leaving the box saves it, Escape puts the number back.
 */
function CellEditor({
  canEdit,
  label,
  value,
  display,
  onCommit,
  inputMode,
  step,
  min,
}: {
  canEdit: boolean;
  label: string;
  value: string;
  display: ReactNode;
  onCommit: (value: string) => void;
  inputMode: "numeric" | "decimal";
  step: number | string;
  min: number;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  // Enter / Escape close the box themselves; the blur its removal may fire must not save again.
  const done = useRef(false);

  if (!canEdit) return <>{display}</>;
  if (draft === null) {
    return (
      <button
        type="button"
        aria-label={`Edit ${label}`}
        onClick={() => {
          done.current = false;
          setDraft(value);
        }}
        className="-mx-1 rounded-[2px] px-1 text-left hover:bg-white hover:underline focus-visible:ring-2 focus-visible:ring-wz-focus focus-visible:outline-none"
      >
        {display}
      </button>
    );
  }

  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && draft.trim() !== "" && draft !== value) onCommit(draft);
    setDraft(null);
  };

  return (
    <input
      type="number"
      aria-label={label}
      autoFocus
      inputMode={inputMode}
      step={step}
      min={min}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(false);
        }
      }}
      className="-my-1.5 h-7 w-full max-w-[100px] rounded-[2px] border border-input bg-white px-2 text-[14px] text-wz-strong tabular-nums outline-none focus:border-wz-focus"
    />
  );
}
