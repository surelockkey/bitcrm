"use client";

import { useState, type ReactNode } from "react";
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
import { Grid3x3, GripVertical, Search } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { WzDrawer } from "./drawer";
import { WzToolbarButton } from "./toolbar";

/** One column the panel offers. `icon` is the glyph at the row's right (Workiz's `wfi-*`). */
export interface WzFieldOption {
  id: string;
  label: string;
  icon?: ReactNode;
}

/**
 * The two lists the panel draws: USED FIELDS in the draft's order, UNSELECTED
 * FIELDS in the registry's, both narrowed by "Search fields" (a
 * case-insensitive part of the label).
 */
export function fieldsPanelLists<T extends { id: string; label: string }>(
  options: readonly T[],
  used: readonly string[],
  query: string,
): { used: T[]; unselected: T[] } {
  const q = query.trim().toLowerCase();
  const hit = (o: T) => !q || o.label.toLowerCase().includes(q);
  const byId = new Map(options.map((o) => [o.id, o]));
  return {
    used: used.map((id) => byId.get(id)).filter((o): o is T => !!o && hit(o)),
    unselected: options.filter((o) => !used.includes(o.id) && hit(o)),
  };
}

/** Ticking a field adds it at the end of USED FIELDS; unticking takes it out. */
export function toggleField(used: readonly string[], id: string): string[] {
  return used.includes(id) ? used.filter((u) => u !== id) : [...used, id];
}

/** A drag: `id` takes `overId`'s slot and the fields between shift by one. */
export function moveField(used: readonly string[], id: string, overId: string): string[] {
  const from = used.indexOf(id);
  const to = used.indexOf(overId);
  if (from < 0 || to < 0 || from === to) return [...used];
  const next = [...used];
  next.splice(from, 1);
  next.splice(to, 0, id);
  return next;
}

/**
 * Workiz's "Visible fields" side panel for any list (list_02_fields_menu on
 * Jobs, pg_contacts_wz_08_fields on Clients): the strip's "Fields" button
 * opens a 422px drawer — "Search fields", USED FIELDS as bordered rows you
 * drag into column order (handle, tick, name, glyph), UNSELECTED FIELDS under
 * them, then Cancel and a yellow "Save fields". Nothing reaches the grid until
 * "Save fields"; Cancel, × or Escape drop the draft. A grid with no columns is
 * not offered: Save waits for at least one tick.
 *
 * `used` is the saved column order; `onSave` gets the new one.
 */
export function WzFieldsPanel({
  options,
  used,
  onSave,
  trigger,
}: {
  options: readonly WzFieldOption[];
  used: readonly string[];
  onSave: (used: string[]) => void;
  /** Defaults to the strip's "Fields" button (82×34, Workiz's 3×3 grid glyph). */
  trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<string[]>([]);

  const openPanel = (next: boolean) => {
    if (next) {
      setDraft(used.filter((id) => options.some((o) => o.id === id)));
      setQuery("");
    }
    setOpen(next);
  };

  const lists = fieldsPanelLists(options, draft, query);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) setDraft((d) => moveField(d, String(active.id), String(over.id)));
  };

  return (
    <WzDrawer
      open={open}
      onOpenChange={openPanel}
      title="Visible fields"
      trigger={
        trigger ?? (
          <WzToolbarButton>
            <Grid3x3 strokeWidth={1.75} />
            Fields
          </WzToolbarButton>
        )
      }
      bodyClassName="pt-6"
      footer={
        <>
          <button
            type="button"
            onClick={() => openPanel(false)}
            className="h-8 rounded-pill px-4 text-[13px] font-semibold tracking-[0.2px] text-foreground hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!draft.length}
            onClick={() => {
              onSave([...draft]);
              setOpen(false);
            }}
            className="h-8 rounded-pill bg-primary px-4 text-[13px] font-semibold tracking-[0.2px] text-primary-foreground hover:bg-wz-primary-hover disabled:cursor-not-allowed disabled:bg-wz-disabled-fill disabled:text-wz-outline"
          >
            Save fields
          </button>
        </>
      }
    >
      {/* pg_contacts_wz_08_fields: "Search fields" 16px/24px 500 at 24px, the 40px box under it. */}
      <h5 className="text-base leading-6 font-medium tracking-[0.2px] text-foreground">Search fields</h5>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-foreground" />
        <input
          placeholder="Type field name here"
          aria-label="Search fields"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 w-full rounded-[4px] border border-wz-outline bg-background pr-4 pl-11 text-[13px] text-foreground outline-none placeholder:text-wz-outline focus:border-wz-link"
        />
      </div>

      <section aria-label="Used fields" className="mt-4">
        <p className="mb-4 text-xs leading-[21px] font-medium tracking-[0.4px] text-wz-outline uppercase">Used fields</p>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={lists.used.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            <div>
              {lists.used.map((o) => (
                <SortableRow key={o.id} option={o} onToggle={() => setDraft((d) => toggleField(d, o.id))} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </section>

      <section aria-label="Unselected fields" className="mt-4">
        <p className="mb-4 text-xs leading-[21px] font-medium tracking-[0.4px] text-wz-outline uppercase">
          Unselected fields
        </p>
        {lists.unselected.map((o) => (
          <FieldRow key={o.id} option={o} checked={false} onToggle={() => setDraft((d) => toggleField(d, o.id))} />
        ))}
      </section>
      {!lists.used.length && !lists.unselected.length ? (
        <p className="text-sm text-wz-caption">No fields match your search.</p>
      ) : null}
    </WzDrawer>
  );
}

/** A USED FIELDS row you can drag by its handle. */
function SortableRow({ option, onToggle }: { option: WzFieldOption; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative", isDragging && "z-10 opacity-80")}
    >
      <FieldRow
        option={option}
        checked
        onToggle={onToggle}
        handle={
          <button
            type="button"
            aria-label={`Move ${option.label}`}
            className="grid w-4 cursor-grab place-items-center text-wz-outline active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="size-4" />
          </button>
        }
      />
    </div>
  );
}

/**
 * One field: a 354×42 box, 1px #dfe2e3, 8px corners, 8px apart; the handle
 * 11px in, the tick at 35px (11px without a handle), the name 14px/500 13px
 * after it, the glyph at the right.
 */
function FieldRow({
  option,
  checked,
  onToggle,
  handle,
}: {
  option: WzFieldOption;
  checked: boolean;
  onToggle: () => void;
  handle?: ReactNode;
}) {
  return (
    <div className="mb-2 flex h-[42px] w-full max-w-[354px] items-center gap-2 rounded-[8px] border border-border bg-background pr-2 pl-[10px]">
      {handle}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-[13px]">
        <Checkbox checked={checked} aria-label={option.label} onCheckedChange={onToggle} />
        <span className="truncate text-sm leading-[21px] font-medium tracking-[0.4px] text-foreground">{option.label}</span>
      </label>
      {option.icon ? (
        <span aria-hidden className="grid size-5 shrink-0 place-items-center text-foreground [&_svg]:size-4">
          {option.icon}
        </span>
      ) : null}
    </div>
  );
}
