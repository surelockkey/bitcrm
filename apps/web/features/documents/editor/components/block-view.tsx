"use client";

import { memo, useCallback, useMemo, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { Copy, GripVertical, Trash2 } from "lucide-react";
import type { DocumentBlock, RichTextNode, TableBlock, TextBlock } from "@bitcrm/types";
import { renderBlockHtml } from "@bitcrm/document-renderer";
import { cn } from "@/lib/utils";
import { blockStyleToCss } from "../../lib";
import { blockTool } from "../catalog";
import type { DragData, DropData } from "../dnd";
import { useEditorStore } from "../store";
import { useCanvasEnv } from "./canvas-context";
import { RichTextEditor, type FocusPoint } from "./rich-text-editor";
import { RichTextStatic } from "./rich-text-static";
import { reportResult } from "./report";

/** Renderer output for a non-text block (escaped/sanitized by the renderer). */
const BlockHtml = memo(function BlockHtml({ block }: { block: DocumentBlock }) {
  const { ctx, tpl } = useCanvasEnv();
  const html = useMemo(() => renderBlockHtml(block, ctx, tpl, { mode: "screen" }), [block, ctx, tpl]);
  if (!html) {
    return <div className="canvas-hint">{block.type === "field" ? "Hidden when the value is empty" : "Nothing to show"}</div>;
  }
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
});

function TextBlockContent({ block, selected, focus }: { block: TextBlock; selected: boolean; focus?: FocusPoint }) {
  const { readOnly } = useCanvasEnv();
  const onChange = useCallback(
    (content: RichTextNode) => useEditorStore.getState().updateBlock(block.id, { content }, { coalesce: `text:${block.id}` }),
    [block.id],
  );
  return (
    <div className="blk blk-text" style={blockStyleToCss(block.style)}>
      <div className="rt">
        {selected && !readOnly ? (
          <RichTextEditor
            value={block.content}
            onChange={onChange}
            ariaLabel="Text block"
            focus={focus ?? true}
            onEscape={() => useEditorStore.getState().select(null)}
          />
        ) : (
          <RichTextStatic node={block.content} placeholder="Empty text — click to type" />
        )}
      </div>
    </div>
  );
}

function TableBlockContent({ block, selected }: { block: TableBlock; selected: boolean }) {
  const { readOnly } = useCanvasEnv();
  const [active, setActive] = useState<{ r: number; c: number; focus?: FocusPoint } | null>(null);
  // Forget the open cell when the block is deselected.
  if (!selected && active) setActive(null);
  const editing = selected && !readOnly ? active : null;
  const cols = block.rows[0]?.length ?? 0;

  const setCell = (r: number, c: number, value: RichTextNode) => {
    const rows = block.rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row));
    useEditorStore.getState().updateBlock(block.id, { rows }, { coalesce: `cell:${block.id}:${r}:${c}` });
  };

  const cell = (r: number, c: number, node: RichTextNode) => {
    const isActive = editing?.r === r && editing?.c === c;
    const Tag = block.headerRow && r === 0 ? "th" : "td";
    return (
      <Tag
        key={c}
        className={cn(selected && "cell-editable", isActive && "cell-active")}
        onClick={(e) => {
          if (!selected || readOnly) return;
          e.stopPropagation();
          if (!isActive) setActive({ r, c, focus: { x: e.clientX, y: e.clientY } });
        }}
      >
        {isActive ? (
          <RichTextEditor
            value={node}
            onChange={(v) => setCell(r, c, v)}
            ariaLabel={`Table cell ${r + 1}, ${c + 1}`}
            placeholder=""
            focus={editing?.focus ?? true}
            onEscape={() => setActive(null)}
          />
        ) : (
          <RichTextStatic node={node} />
        )}
      </Tag>
    );
  };

  const [first, ...rest] = block.rows;
  return (
    <div className="blk blk-table" style={blockStyleToCss(block.style)}>
      <table className={cn("tbl", block.bordered && "bordered")}>
        {block.columnWidths?.length ? (
          <colgroup>
            {block.columnWidths.slice(0, cols).map((w, i) => (
              <col key={i} style={{ width: `${w}%` }} />
            ))}
          </colgroup>
        ) : null}
        {block.headerRow && first ? (
          <thead>
            <tr>{first.map((n, c) => cell(0, c, n))}</tr>
          </thead>
        ) : null}
        <tbody>
          {(block.headerRow ? rest : block.rows).map((row, i) => {
            const r = block.headerRow ? i + 1 : i;
            return <tr key={r}>{row.map((n, c) => cell(r, c, n))}</tr>;
          })}
        </tbody>
      </table>
    </div>
  );
}

export const BlockView = memo(function BlockView({ block }: { block: DocumentBlock }) {
  const { readOnly } = useCanvasEnv();
  const selected = useEditorStore((s) => s.selection?.type === "block" && s.selection.id === block.id);
  const [focus, setFocus] = useState<FocusPoint | undefined>();
  const tool = blockTool(block.type);

  const drag: DragData = { kind: "block", blockId: block.id };
  const drop: DropData = { kind: "block", blockId: block.id };
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, isDragging } = useSortable({
    id: `block:${block.id}`,
    data: { drag, drop },
    disabled: readOnly,
  });

  // Text being edited must keep native pointer behaviour (selection, caret).
  const wholeBlockDrag = !readOnly && !(selected && (block.type === "text" || block.type === "table"));

  const select = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!selected) {
      setFocus(block.type === "text" ? { x: e.clientX, y: e.clientY } : undefined);
      useEditorStore.getState().select({ type: "block", id: block.id });
    }
  };

  return (
    <div
      ref={setNodeRef}
      data-block-id={block.id}
      className={cn(
        "blk-wrap group/block relative rounded-[2px] outline-offset-2",
        !readOnly && "hover:outline hover:outline-1 hover:outline-dashed hover:outline-amber-400",
        selected && "outline outline-2 outline-amber-500 hover:outline-solid hover:outline-2 hover:outline-amber-500",
        isDragging && "opacity-40",
        wholeBlockDrag && "cursor-grab",
      )}
      onClick={select}
      {...(wholeBlockDrag ? listeners : {})}
      {...attributes}
      role="group"
      aria-roledescription="block"
      aria-label={`${tool.label} block`}
      aria-current={selected ? "true" : undefined}
      tabIndex={readOnly ? -1 : 0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" && !selected) {
          e.preventDefault();
          useEditorStore.getState().select({ type: "block", id: block.id });
          return;
        }
        if (wholeBlockDrag) listeners?.onKeyDown?.(e);
      }}
    >
      {!readOnly ? (
        <div
          className={cn(
            "canvas-chrome absolute -top-6 left-0 z-30 h-6 items-center gap-0.5 rounded-t-md bg-amber-500 px-1 text-white shadow-sm",
            selected ? "flex" : "hidden group-hover/block:flex",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...listeners}
            className="flex size-5 cursor-grab items-center justify-center rounded hover:bg-white/20 active:cursor-grabbing"
            aria-label={`Drag ${tool.label} block`}
          >
            <GripVertical className="size-3.5" />
          </button>
          <span className="px-1 text-[11px] font-medium leading-none">{tool.label}</span>
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded hover:bg-white/20"
            aria-label={`Duplicate ${tool.label} block`}
            onClick={() => reportResult(useEditorStore.getState().duplicateBlock(block.id))}
          >
            <Copy className="size-3" />
          </button>
          <button
            type="button"
            className="flex size-5 items-center justify-center rounded hover:bg-white/20"
            aria-label={`Delete ${tool.label} block`}
            onClick={() => useEditorStore.getState().removeBlock(block.id)}
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ) : null}

      {block.type === "text" ? (
        <TextBlockContent block={block} selected={selected} focus={focus} />
      ) : block.type === "table" ? (
        <TableBlockContent block={block} selected={selected} />
      ) : (
        <BlockHtml block={block} />
      )}
    </div>
  );
});
