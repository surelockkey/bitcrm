"use client";

import { Fragment, memo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { ArrowDown, ArrowUp, Columns3, Copy, GripVertical, Plus, Trash2 } from "lucide-react";
import type { DocumentColumn, DocumentRow } from "@bitcrm/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { ROW_LAYOUTS, blockStyleToCss, spansLabel } from "../../lib";
import { SECTION_LABELS } from "../catalog";
import type { DragData, DropData } from "../dnd";
import { useEditorStore } from "../store";
import type { SectionId } from "../tree";
import { useEditorUi } from "../ui-store";
import { BlockView } from "./block-view";
import { useCanvasEnv } from "./canvas-context";
import { LayoutGlyph } from "./layout-glyph";
import { reportResult } from "./report";

/** A zero-height insertion marker (absolute, so it never shifts layout). */
function DropLine({ className }: { className?: string }) {
  return (
    <div className="relative h-0" aria-hidden>
      <div className={cn("absolute inset-x-0 -top-[2px] z-20 h-1 rounded-full bg-sky-500 shadow-[0_0_0_2px_rgba(14,165,233,0.25)]", className)} />
    </div>
  );
}

const V_ALIGN = { top: "start", middle: "center", bottom: "end" } as const;

/* ---------------------------------------------------------------- column */

const ColumnView = memo(function ColumnView({ column }: { column: DocumentColumn }) {
  const { readOnly } = useCanvasEnv();
  const drop: DropData = { kind: "column", columnId: column.id };
  const { setNodeRef } = useDroppable({ id: `column:${column.id}`, data: { drop }, disabled: readOnly });
  const hintIndex = useEditorUi((s) => (s.dropHint?.kind === "block" && s.dropHint.columnId === column.id ? s.dropHint.index : -1));
  const isActive = useEditorStore((s) => s.activeColumnId === column.id);
  const empty = column.blocks.length === 0;

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "col relative min-h-6 rounded-[2px]",
        !readOnly && "outline-offset-1",
        hintIndex >= 0 && "bg-sky-500/5 outline outline-1 outline-sky-400",
        isActive && hintIndex < 0 && !readOnly && "outline outline-1 outline-dashed outline-amber-300",
      )}
      style={{ gridColumn: `span ${column.span}`, alignSelf: column.verticalAlign ? V_ALIGN[column.verticalAlign] : undefined }}
      onClick={() => !readOnly && useEditorStore.getState().setActiveColumn(column.id)}
    >
      <SortableContext items={column.blocks.map((b) => `block:${b.id}`)} strategy={verticalListSortingStrategy}>
        {column.blocks.map((b, i) => (
          <Fragment key={b.id}>
            {hintIndex === i ? <DropLine /> : null}
            <BlockView block={b} />
          </Fragment>
        ))}
        {hintIndex === column.blocks.length && !empty ? <DropLine className="top-[3px]" /> : null}
      </SortableContext>
      {empty && !readOnly ? (
        <button
          type="button"
          className={cn(
            "canvas-chrome flex min-h-12 w-full items-center justify-center gap-1 rounded border border-dashed text-[11px] transition-colors",
            hintIndex >= 0 ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-300 bg-slate-50/70 text-slate-400 hover:border-amber-400 hover:text-amber-600",
          )}
          onClick={(e) => {
            e.stopPropagation();
            useEditorStore.getState().setActiveColumn(column.id);
            useEditorUi.getState().setLeftTab("tools");
          }}
        >
          <Plus className="size-3" /> Drag something here
        </button>
      ) : null}
    </div>
  );
});

/* ------------------------------------------------------------------- row */

function ToolbarButton({ label, onClick, children, disabled }: { label: string; onClick?: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-5 items-center justify-center rounded hover:bg-white/20 disabled:opacity-40"
    >
      {children}
    </button>
  );
}

const RowView = memo(function RowView({ row, section, index, count }: { row: DocumentRow; section: SectionId; index: number; count: number }) {
  const { readOnly } = useCanvasEnv();
  const selected = useEditorStore((s) => s.selection?.type === "row" && s.selection.id === row.id);
  const drag: DragData = { kind: "row", rowId: row.id };
  const drop: DropData = { kind: "row", rowId: row.id };
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useSortable({
    id: `row:${row.id}`,
    data: { drag, drop },
    disabled: readOnly,
  });
  const spans = row.columns.map((c) => c.span);
  const store = useEditorStore.getState;

  return (
    <div
      ref={setNodeRef}
      data-row-id={row.id}
      className={cn(
        "group/row relative",
        !readOnly && "hover:outline hover:outline-1 hover:outline-amber-300",
        selected && "outline outline-2 outline-amber-400 hover:outline-2 hover:outline-amber-400",
        isDragging && "opacity-40",
      )}
      onClick={(e) => {
        if (readOnly) return;
        e.stopPropagation();
        if (!selected) store().select({ type: "row", id: row.id });
      }}
    >
      {!readOnly ? (
        <div
          className={cn(
            "canvas-chrome absolute -top-6 right-0 z-30 h-6 items-center gap-0.5 rounded-t-md bg-amber-400 px-1 text-amber-950 shadow-sm",
            selected ? "flex" : "hidden group-hover/row:flex",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            {...listeners}
            aria-roledescription="draggable row"
            aria-label={`Drag row ${index + 1}`}
            className="flex size-5 cursor-grab items-center justify-center rounded hover:bg-white/30 active:cursor-grabbing"
          >
            <GripVertical className="size-3.5" />
          </button>
          <span className="px-1 text-[11px] font-medium leading-none">Row · {spansLabel(spans)}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="Change column layout" title="Change column layout" className="flex size-5 items-center justify-center rounded hover:bg-white/30">
                <Columns3 className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuLabel className="text-xs">Column layout</DropdownMenuLabel>
              {ROW_LAYOUTS.map((l) => (
                <DropdownMenuItem
                  key={l.id}
                  onSelect={() => reportResult(store().setRowLayout(row.id, l.spans))}
                  className={cn(spansLabel(l.spans) === spansLabel(spans) && "bg-accent")}
                >
                  <LayoutGlyph spans={l.spans} className="w-10" />
                  <span className="text-xs">{l.label}</span>
                  {l.spans.length < spans.length ? <span className="ml-auto text-[10px] text-muted-foreground">merges</span> : null}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <ToolbarButton label="Move row up" disabled={index === 0} onClick={() => store().moveRow(row.id, section, index - 1)}>
            <ArrowUp className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Move row down" disabled={index === count - 1} onClick={() => store().moveRow(row.id, section, index + 1)}>
            <ArrowDown className="size-3.5" />
          </ToolbarButton>
          <ToolbarButton label="Duplicate row" onClick={() => reportResult(store().duplicateRow(row.id))}>
            <Copy className="size-3" />
          </ToolbarButton>
          <ToolbarButton label="Delete row" onClick={() => store().removeRow(row.id)}>
            <Trash2 className="size-3" />
          </ToolbarButton>
        </div>
      ) : null}
      <div className="row" style={{ columnGap: row.gap ?? 16, ...blockStyleToCss(row.style) }}>
        {row.columns.map((c) => (
          <ColumnView key={c.id} column={c} />
        ))}
      </div>
    </div>
  );
});

/* --------------------------------------------------------------- section */

const SECTION_CLASS: Record<SectionId, string> = { header: "doc-header", body: "doc-body", footer: "doc-footer" };

export const SectionZone = memo(function SectionZone({ section, rows }: { section: SectionId; rows: DocumentRow[] }) {
  const { readOnly } = useCanvasEnv();
  const drop: DropData = { kind: "section", section };
  const { setNodeRef } = useDroppable({ id: `section:${section}`, data: { drop }, disabled: readOnly });
  const hintIndex = useEditorUi((s) => (s.dropHint?.kind === "row" && s.dropHint.section === section ? s.dropHint.index : -1));
  const active = useEditorStore((s) => s.activeSection === section);
  const meta = SECTION_LABELS[section];

  return (
    <div
      ref={setNodeRef}
      data-section={section}
      className={cn(
        SECTION_CLASS[section],
        "group/section relative",
        !readOnly && "outline-1 outline-offset-4 hover:outline hover:outline-dashed hover:outline-slate-300",
        !readOnly && active && "outline outline-dashed outline-slate-300",
        hintIndex >= 0 && rows.length === 0 && "outline outline-sky-400",
      )}
      onClick={() => {
        if (readOnly) return;
        const s = useEditorStore.getState();
        s.setActiveSection(section);
        s.select(null);
      }}
    >
      {!readOnly ? (
        <span
          className={cn(
            "canvas-chrome pointer-events-none absolute -left-2 top-0 z-10 -translate-x-full rounded bg-slate-500 px-1.5 py-0.5 text-[10px] font-medium text-white transition-opacity",
            active ? "opacity-90" : "opacity-0 group-hover/section:opacity-70",
          )}
          title={meta.hint}
        >
          {meta.label}
        </span>
      ) : null}
      <SortableContext items={rows.map((r) => `row:${r.id}`)} strategy={verticalListSortingStrategy}>
        {rows.map((r, i) => (
          <Fragment key={r.id}>
            {hintIndex === i ? <DropLine /> : null}
            <RowView row={r} section={section} index={i} count={rows.length} />
          </Fragment>
        ))}
        {hintIndex === rows.length && rows.length > 0 ? <DropLine className="top-[3px]" /> : null}
      </SortableContext>
      {rows.length === 0 && !readOnly ? (
        <button
          type="button"
          className={cn(
            "canvas-chrome flex h-12 w-full items-center justify-center gap-1.5 rounded border border-dashed text-[11px]",
            hintIndex >= 0 ? "border-sky-400 bg-sky-50 text-sky-700" : "border-slate-300 text-slate-400 hover:border-amber-400 hover:text-amber-600",
          )}
          onClick={(e) => {
            e.stopPropagation();
            reportResult(useEditorStore.getState().addRow(section, [12]));
          }}
        >
          <Plus className="size-3" /> {meta.label}: drag a row here or click to add one
        </button>
      ) : null}
    </div>
  );
});
