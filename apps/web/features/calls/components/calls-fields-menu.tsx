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
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Grid3x3, GripVertical, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { WzDrawer, WzDrawerSection } from "@/components/workiz/drawer";
import { WzToolbarButton } from "@/components/workiz/toolbar";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { draftFromSaved, moveDraft, panelLists, savedFromDraft, toggleDraft } from "@/features/deals/fields";
import { callColumnOptions, useCallFieldsStore, type CallColumn } from "../fields";

/**
 * Workiz's "Edit Columns" on the call log (callspage_wz_07_fields): the
 * kit's side drawer — "Search fields", FIELDS IN USE as bordered rows you
 * drag into column order (handle, tick, name), UNSELECTED FIELDS under them,
 * Cancel / "Save fields". Nothing reaches the grid until "Save fields".
 * Workiz's unselected list is its AI upsell (Sentiment, Intent…); ours holds
 * our own extra column, the linked job's tags.
 */
export function CallsFieldsMenu() {
  const { can } = usePermissions();
  const visible = useCallFieldsStore((s) => s.visible);
  const order = useCallFieldsStore((s) => s.order);
  const save = useCallFieldsStore((s) => s.save);
  const options = callColumnOptions(can("financials", "view"));

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [used, setUsed] = useState<string[]>([]);

  const openPanel = (next: boolean) => {
    if (next) {
      setUsed(draftFromSaved(options, visible, order));
      setQuery("");
    }
    setOpen(next);
  };

  const lists = panelLists(options, used, query);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) setUsed((u) => moveDraft(u, String(active.id), String(over.id)));
  };

  return (
    <WzDrawer
      open={open}
      onOpenChange={openPanel}
      title="Edit Columns"
      trigger={
        <WzToolbarButton>
          <Grid3x3 strokeWidth={1.75} />
          Fields
        </WzToolbarButton>
      }
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              save(savedFromDraft(options, used));
              setOpen(false);
            }}
          >
            Save fields
          </Button>
        </>
      }
    >
      <h5 className="text-base leading-6 font-medium tracking-[0.2px]">Search fields</h5>
      <div className="relative mb-6">
        <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-foreground" />
        <input
          placeholder="Type field name here"
          aria-label="Search fields"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-10 w-full rounded-[4px] border border-wz-outline bg-background pr-4 pl-11 text-[13px] outline-none placeholder:text-wz-outline focus:border-wz-link"
        />
      </div>
      <WzDrawerSection title="Fields in use">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
          onDragEnd={onDragEnd}
        >
          <SortableContext items={lists.used.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            <div>
              {lists.used.map((o) => (
                <SortableRow key={o.id} option={o} onToggle={() => setUsed((u) => toggleDraft(u, o.id))} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      </WzDrawerSection>
      <WzDrawerSection title="Unselected fields">
        {lists.unselected.map((o) => (
          <FieldRow key={o.id} option={o} checked={false} onToggle={() => setUsed((u) => toggleDraft(u, o.id))} />
        ))}
        {!lists.used.length && !lists.unselected.length ? (
          <p className="text-sm text-wz-caption">No fields match your search.</p>
        ) : null}
      </WzDrawerSection>
    </WzDrawer>
  );
}

function SortableRow({ option, onToggle }: { option: CallColumn; onToggle: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: option.id });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cn("relative", isDragging && "z-10 opacity-80")}>
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

/** One field: callspage_wz_07 — a 374×42 box, 1px #dfe2e3, radius 8, 8px apart; handle, tick, name. */
function FieldRow({
  option,
  checked,
  onToggle,
  handle,
}: {
  option: CallColumn;
  checked: boolean;
  onToggle: () => void;
  handle?: ReactNode;
}) {
  return (
    <div className="mb-2 flex h-[42px] w-full items-center gap-2 rounded-[8px] border border-border bg-background pr-2 pl-[10px]">
      {handle ?? <span className="w-4" aria-hidden />}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-[13px]">
        <Checkbox checked={checked} onCheckedChange={onToggle} />
        <span className="truncate text-sm leading-[21px] font-medium tracking-[0.4px]">{option.label}</span>
      </label>
    </div>
  );
}
