"use client";

import { useDraggable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { ROW_LAYOUTS, spansLabel, type RowLayout } from "../../lib";
import { SECTION_LABELS, toolsForKind, type BlockTool } from "../catalog";
import type { DragData } from "../dnd";
import { useEditorStore } from "../store";
import { reportResult } from "./report";

/**
 * Workiz's designer card (`card widget c_hover`, pg_settings_general_wz_doc_tab_tools):
 * white, 1px corners, the two-part card shadow, lifting under the cursor
 * (`.c_hover`: 0 12px 12px -8px rgba(0,0,0,.4)).
 */
const CARD =
  "rounded-[1px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.16),0_2px_10px_rgba(0,0,0,0.12)] transition-shadow hover:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4),0_1px_3px_rgba(0,0,0,0.16),0_2px_10px_rgba(0,0,0,0.12)]";

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
        "group cursor-grab touch-none text-left select-none outline-none focus-visible:ring-2 focus-visible:ring-wz-focus active:cursor-grabbing",
        CARD,
        isDragging && "opacity-50",
        className,
      )}
    >
      {children}
    </button>
  );
}

/** The 12px #768287 line over a panel's cards. */
function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs leading-[18px] tracking-[0.4px] text-wz-outline-label">{children}</p>;
}

/**
 * Workiz's Layout tab: a full-width card per row shape, its columns drawn as
 * #eeeeee bars 40px tall (`_dsGridPreview`), 15px in, 20px apart.
 */
export function LayoutPanel() {
  const section = useEditorStore((s) => s.activeSection);
  const add = (l: RowLayout) => reportResult(useEditorStore.getState().addRow(section, l.spans));
  return (
    <div className="flex flex-col gap-5 p-2.5">
      <Hint>
        Drag a row onto the page, or click to add it to the{" "}
        <span className="font-medium text-foreground">{SECTION_LABELS[section].label.toLowerCase()}</span>.
      </Hint>
      {ROW_LAYOUTS.map((l) => (
        <PaletteItem
          key={l.id}
          id={`palette-row:${l.id}`}
          drag={{ kind: "palette-row", spans: l.spans }}
          label={`Add row: ${l.label}`}
          description={`${l.label} (${spansLabel(l.spans)})`}
          onActivate={() => add(l)}
          className="flex w-full gap-2.5 p-[15px]"
        >
          {l.spans.map((s, i) => (
            // #eeeeee: Workiz's grid preview bar, a one-off.
            <span key={i} aria-hidden className="h-10 min-w-0 bg-[#eeeeee]" style={{ flexGrow: s, flexBasis: 0 }} />
          ))}
        </PaletteItem>
      ))}
    </div>
  );
}

/**
 * Workiz's Tools tab: three cards to a row (130×98 in its 472px panel), a line
 * glyph over the tool's name in capitals; drag one into a column or click it.
 */
export function ToolsPanel() {
  const kind = useEditorStore((s) => s.draft?.kind ?? "invoice");
  const add = (t: BlockTool) => reportResult(useEditorStore.getState().addBlock(t.type));
  return (
    <div className="flex flex-col gap-5 p-2.5">
      <Hint>Drag a block into a column, or click to insert it after the selection.</Hint>
      <div className="grid grid-cols-3 gap-x-4 gap-y-5">
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
              className="flex h-[98px] flex-col items-center justify-center gap-2.5 border border-wz-frame p-[15px] text-center"
            >
              <Icon className="size-8 text-foreground" strokeWidth={1.25} aria-hidden />
              <span className="max-w-full truncate text-xs leading-4 tracking-[0.4px] text-wz-strong uppercase">{t.label}</span>
            </PaletteItem>
          );
        })}
      </div>
    </div>
  );
}
