"use client";

import { useState, type ReactNode } from "react";
import { Dialog } from "radix-ui";
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
import {
  BarChart3,
  CalendarDays,
  CircleDollarSign,
  Diamond,
  GripVertical,
  Mail,
  Map as MapIcon,
  MapPin,
  Phone,
  Search,
  Table2,
  Tag,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useCustomFields } from "@/features/custom-fields/hooks";
import {
  draftFromSaved,
  jobFieldOptions,
  moveDraft,
  panelLists,
  savedFromDraft,
  toggleDraft,
  type FieldIcon,
  type JobFieldOption,
} from "../fields";
import { useJobFieldsStore } from "../fields-store";

/** Workiz's panel glyphs (`wfi-*`), drawn with their nearest lucide twins. */
const ICONS: Record<FieldIcon, ReactNode> = {
  job: <Wrench />,
  users: <Users />,
  tag: <Tag />,
  location: <MapPin />,
  calendar: <CalendarDays />,
  money: <CircleDollarSign />,
  phone: <Phone />,
  email: <Mail />,
  map: <MapIcon />,
  source: <BarChart3 />,
  custom: <Diamond />,
};

/** The Job ID row: always first and always on, as the table draws it. */
const JOB_ID: JobFieldOption = { id: "__jobId", label: "Job ID", width: 0, icon: "job" };

/**
 * Workiz's "Visible fields" side panel (list_02_fields_menu): a 422px drawer
 * over a dimmed page — "Search fields", USED FIELDS as bordered rows you drag
 * into column order (handle, tick, name, glyph), UNSELECTED FIELDS under
 * them, and "Cancel" / a yellow "Save fields" pill at the bottom. Nothing
 * reaches the table until "Save fields"; Cancel, × or Escape drop the draft.
 */
export function FieldsMenu() {
  const visible = useJobFieldsStore((s) => s.visible);
  const order = useJobFieldsStore((s) => s.order);
  const save = useJobFieldsStore((s) => s.save);
  const { data: customFieldDefs } = useCustomFields();
  const options = jobFieldOptions(customFieldDefs);

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
  const jobIdShown = !query.trim() || JOB_ID.label.toLowerCase().includes(query.trim().toLowerCase());

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) setUsed((u) => moveDraft(u, String(active.id), String(over.id)));
  };

  return (
    <Dialog.Root open={open} onOpenChange={openPanel}>
      <Dialog.Trigger asChild>
        {/* list_01: 82×34, 1px #ccc, radius 2, 14px, a table glyph before the word. */}
        <button
          type="button"
          className="inline-flex h-[34px] items-center gap-1 rounded-chip border border-input bg-background px-2.5 text-sm text-[#404040] hover:bg-muted"
        >
          <Table2 className="size-3.5" />
          Fields
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        {/* The page dims to 36% black under the panel (#ffffff → #a3a3a3). */}
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/[0.36] data-open:animate-in data-open:fade-in-0" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[422px] max-w-full flex-col bg-background text-[#3b4b52] shadow-lg data-open:animate-in data-open:slide-in-from-right-10"
        >
          <div className="flex h-[47px] shrink-0 items-center justify-between pr-[15px] pl-6">
            <Dialog.Title className="text-lg leading-[19px] font-semibold text-[#3b4c53]">Visible fields</Dialog.Title>
            <Dialog.Close aria-label="Close" className="grid size-6 place-items-center text-[#607890] hover:text-foreground">
              <X className="size-[18px]" />
            </Dialog.Close>
          </div>

          <div className="shrink-0 px-6 pt-6">
            <h5 className="text-base leading-6 font-medium tracking-[0.2px]">Search fields</h5>
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-[#3b4b52]" />
              <input
                placeholder="Type field name here"
                aria-label="Search fields"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-10 w-full rounded-[4px] border border-[#9ea6aa] bg-background pr-4 pl-11 text-[13px] outline-none placeholder:text-[#9ea6aa] focus:border-[#6aa8ee]"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-4 pb-20">
            <p className="mb-4 text-xs leading-[21px] font-medium tracking-[0.4px] text-[#9ea6aa] uppercase">Used fields</p>
            {jobIdShown ? <FieldRow option={JOB_ID} checked locked /> : null}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis, restrictToParentElement]}
              onDragEnd={onDragEnd}
            >
              <SortableContext items={lists.used.map((o) => o.id)} strategy={verticalListSortingStrategy}>
                <div>
                  {lists.used.map((o) => (
                    <SortableFieldRow key={o.id} option={o} onToggle={() => setUsed((u) => toggleDraft(u, o.id))} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>

            <p className="mt-4 mb-4 text-xs leading-[21px] font-medium tracking-[0.4px] text-[#9ea6aa] uppercase">
              Unselected fields
            </p>
            {lists.unselected.map((o) => (
              <FieldRow key={o.id} option={o} checked={false} onToggle={() => setUsed((u) => toggleDraft(u, o.id))} />
            ))}
            {!lists.used.length && !lists.unselected.length && !jobIdShown ? (
              <p className="text-sm text-muted-foreground">No fields match your search.</p>
            ) : null}
          </div>

          {/* list_02: Cancel (text) and Save fields (yellow pill), 32px, bottom right. */}
          <div className="pointer-events-none absolute right-6 bottom-3 flex items-center gap-[9px]">
            <Dialog.Close asChild>
              <button
                type="button"
                className="pointer-events-auto h-8 rounded-pill px-4 text-[13px] font-semibold tracking-[0.2px] text-[#3b4b52] hover:bg-muted"
              >
                Cancel
              </button>
            </Dialog.Close>
            <button
              type="button"
              onClick={() => {
                save(savedFromDraft(options, used));
                setOpen(false);
              }}
              className="pointer-events-auto h-8 rounded-pill bg-primary px-4 text-[13px] font-semibold tracking-[0.2px] text-primary-foreground hover:bg-primary/85"
            >
              Save fields
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** A USED FIELDS row you can drag by its handle. */
function SortableFieldRow({ option, onToggle }: { option: JobFieldOption; onToggle: () => void }) {
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
            className="grid w-4 cursor-grab place-items-center text-[#9ea6aa] active:cursor-grabbing"
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
 * One field: list_02 measures a 354×42 box, 1px #dfe2e3, radius 8, 8px
 * padding, 8px apart; a 13px tick, the name 14px/500, the glyph at the right.
 */
function FieldRow({
  option,
  checked,
  onToggle,
  locked = false,
  handle,
}: {
  option: JobFieldOption;
  checked: boolean;
  onToggle?: () => void;
  locked?: boolean;
  handle?: ReactNode;
}) {
  return (
    <div className="mb-2 flex h-[42px] w-full max-w-[354px] items-center gap-2.5 rounded-[8px] border border-border bg-background px-2">
      {handle ?? (locked ? <span className="w-4" aria-hidden /> : null)}
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-[13px]">
        <Checkbox
          checked={checked}
          disabled={locked}
          onCheckedChange={() => onToggle?.()}
          // list_02: Workiz's tick is its link blue, #6aa8ee.
          className="size-[13px] rounded-[2px] border-[#767676] data-[state=checked]:border-[#6aa8ee] data-[state=checked]:bg-[#6aa8ee] disabled:opacity-100 [&_svg]:size-2.5"
        />
        <span className="truncate text-sm leading-[21px] font-medium tracking-[0.4px]">{option.label}</span>
      </label>
      <span aria-hidden className="grid size-5 shrink-0 place-items-center text-[#3b4b52] [&_svg]:size-4">
        {ICONS[option.icon]}
      </span>
    </div>
  );
}
