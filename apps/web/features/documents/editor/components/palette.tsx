"use client";

import { useDraggable } from "@dnd-kit/core";
import { GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import { ROW_LAYOUTS, spansLabel, type RowLayout } from "../../lib";
import { SECTION_LABELS, toolsForKind, type BlockTool } from "../catalog";
import type { DragData } from "../dnd";
import { useEditorStore } from "../store";
import { LayoutGlyph } from "./layout-glyph";
import { PanelSection } from "./controls";
import { reportResult } from "./report";

function PaletteItem({
  id,
  drag,
  label,
  description,
  onActivate,
  children,
  className,
}: {
  id: string;
  drag: DragData;
  label: string;
  description: string;
  onActivate: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id, data: { drag } });
  return (
    <button
      ref={setNodeRef}
      type="button"
      {...attributes}
      {...listeners}
      aria-label={label}
      title={description}
      onClick={onActivate}
      className={cn(
        "group flex cursor-grab touch-none items-center gap-2 rounded-lg border bg-background text-left text-xs transition-colors select-none hover:border-amber-400 hover:bg-amber-50/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none active:cursor-grabbing dark:hover:bg-amber-400/10",
        isDragging && "opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function LayoutPanel() {
  const section = useEditorStore((s) => s.activeSection);
  const add = (l: RowLayout) => reportResult(useEditorStore.getState().addRow(section, l.spans));
  return (
    <PanelSection title="Rows">
      <p className="text-xs text-muted-foreground">
        Drag a row onto the page, or click to add it to the <span className="font-medium text-foreground">{SECTION_LABELS[section].label.toLowerCase()}</span>.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {ROW_LAYOUTS.map((l) => (
          <PaletteItem
            key={l.id}
            id={`palette-row:${l.id}`}
            drag={{ kind: "palette-row", spans: l.spans }}
            label={`Add row: ${l.label}`}
            description={`${l.label} (${spansLabel(l.spans)})`}
            onActivate={() => add(l)}
            className="flex-col items-stretch p-2"
          >
            <LayoutGlyph spans={l.spans} className="h-7 text-slate-400 group-hover:text-amber-500" />
            <span className="text-center text-[11px] text-muted-foreground">{spansLabel(l.spans)}</span>
          </PaletteItem>
        ))}
      </div>
    </PanelSection>
  );
}

export function ToolsPanel() {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const add = (t: BlockTool) => reportResult(useEditorStore.getState().addBlock(t.type));
  return (
    <PanelSection title="Blocks">
      <p className="text-xs text-muted-foreground">Drag a block into a column, or click to insert it after the selection.</p>
      <div className="grid grid-cols-2 gap-2">
        {toolsForKind(kind).map((t) => {
          const Icon = t.icon;
          return (
            <PaletteItem
              key={t.type}
              id={`palette-block:${t.type}`}
              drag={{ kind: "palette-block", blockType: t.type }}
              label={`Add ${t.label} block`}
              description={t.hint}
              onActivate={() => add(t)}
              className="px-2 py-2"
            >
              <span className="flex size-7 flex-none items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-amber-100 group-hover:text-amber-700 dark:group-hover:bg-amber-400/20">
                <Icon className="size-4" />
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{t.label}</span>
              <GripVertical className="size-3 flex-none text-muted-foreground/50" />
            </PaletteItem>
          );
        })}
      </div>
    </PanelSection>
  );
}
