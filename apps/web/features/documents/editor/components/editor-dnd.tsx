"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  pointerWithin,
  useSensor,
  useSensors,
  type Active,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  type Over,
} from "@dnd-kit/core";
import { snapCenterToCursor } from "@dnd-kit/modifiers";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import { Rows3 } from "lucide-react";
import { spansLabel } from "../../lib";
import { blockTool } from "../catalog";
import { acceptsDrop, applyDrop, computeDropHint, type DragData, type DropData } from "../dnd";
import { useEditorStore } from "../store";
import { getBlock } from "../tree";
import { useEditorUi } from "../ui-store";
import { LayoutGlyph } from "./layout-glyph";
import { reportResult } from "./report";

const dragOf = (a: Active | null | undefined): DragData | undefined => a?.data.current?.drag as DragData | undefined;
const dropOf = (o: Over | null | undefined): DropData | undefined => o?.data.current?.drop as DropData | undefined;

/** Most specific target first: a row/block beats its section/column. */
const SPECIFICITY: Record<DropData["kind"], number> = { row: 2, block: 2, section: 1, column: 1 };

/**
 * Rows only land on rows/sections and blocks only on blocks/columns. Among
 * the targets under the pointer, the most specific (deepest) wins.
 */
const collisionDetection: CollisionDetection = (args) => {
  const drag = dragOf(args.active);
  if (!drag) return [];
  const droppableContainers = args.droppableContainers.filter((c) => {
    const drop = c.data.current?.drop as DropData | undefined;
    return !!drop && acceptsDrop(drag, drop);
  });
  const filtered = { ...args, droppableContainers };
  const hits = pointerWithin(filtered);
  if (hits.length) {
    const kindOf = (id: string | number) => (droppableContainers.find((c) => c.id === id)?.data.current?.drop as DropData).kind;
    return [...hits].sort((a, b) => SPECIFICITY[kindOf(b.id)] - SPECIFICITY[kindOf(a.id)]);
  }
  return closestCenter(filtered);
};

function DragChip({ drag }: { drag: DragData }) {
  let icon: ReactNode = <Rows3 className="size-3.5" />;
  let label = "Row";
  if (drag.kind === "palette-row") {
    icon = <LayoutGlyph spans={drag.spans} className="w-8 text-sky-600" />;
    label = `Row ${spansLabel(drag.spans)}`;
  } else if (drag.kind === "palette-block" || drag.kind === "block") {
    const type =
      drag.kind === "palette-block"
        ? drag.blockType
        : getBlock(useEditorStore.getState().draft!.content, drag.blockId)?.type ?? "text";
    const tool = blockTool(type);
    const Icon = tool.icon;
    icon = <Icon className="size-3.5" />;
    label = tool.label;
  }
  return (
    <div className="flex cursor-grabbing items-center gap-2 rounded-md border border-sky-300 bg-background px-2.5 py-1.5 text-xs font-medium shadow-lg">
      {icon}
      {label}
    </div>
  );
}

/** Drag-and-drop for the palette and the canvas. */
export function EditorDnd({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<DragData | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const updateHint = (e: DragMoveEvent) => {
    const drag = dragOf(e.active);
    const content = useEditorStore.getState().draft?.content;
    if (!drag || !content || !e.over) return useEditorUi.getState().setDropHint(null);
    const translated = e.active.rect.current.translated;
    const pointerY = start.current ? start.current.y + e.delta.y : translated ? translated.top + translated.height / 2 : 0;
    useEditorUi.getState().setDropHint(computeDropHint(content, drag, dropOf(e.over) ?? null, pointerY, e.over.rect));
  };

  const onDragStart = (e: DragStartEvent) => {
    const evt = e.activatorEvent;
    start.current = evt instanceof PointerEvent || evt instanceof MouseEvent ? { x: evt.clientX, y: evt.clientY } : null;
    setActive(dragOf(e.active) ?? null);
    // Blur any inline editor so the text commits before the tree changes.
    useEditorUi.getState().textEditor?.commands.blur();
  };

  const finish = () => {
    setActive(null);
    start.current = null;
    useEditorUi.getState().setDropHint(null);
  };

  const onDragEnd = (e: DragEndEvent) => {
    const drag = dragOf(e.active);
    const hint = useEditorUi.getState().dropHint;
    if (drag && e.over) reportResult(applyDrop(useEditorStore.getState(), drag, hint));
    finish();
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={onDragStart}
      onDragMove={updateHint}
      onDragOver={updateHint}
      onDragEnd={onDragEnd}
      onDragCancel={finish}
      accessibility={{
        screenReaderInstructions: {
          draggable: "To pick up an item, press space or enter. Use the arrow keys to move it, space or enter to drop, escape to cancel.",
        },
      }}
    >
      {children}
      <DragOverlay dropAnimation={null} modifiers={[snapCenterToCursor]}>
        {active ? (
          <div className="pointer-events-none flex size-full items-center justify-center">
            <DragChip drag={active} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
