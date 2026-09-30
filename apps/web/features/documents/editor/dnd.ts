/**
 * Drag-and-drop model for the template canvas. Drags carry {@link DragData};
 * droppables carry {@link DropData}. While dragging, the canvas shows an
 * insertion line at the {@link DropHint} computed from the pointer position;
 * dropping applies it through the editor store.
 */
import type { DocumentBlockType, DocumentTemplateContent } from "@bitcrm/types";
import type { ActionResult, EditorState } from "./store";
import { findBlock, findColumn, findRow, type SectionId } from "./tree";

export type DragData =
  | { kind: "palette-row"; spans: number[] }
  | { kind: "palette-block"; blockType: DocumentBlockType }
  | { kind: "row"; rowId: string }
  | { kind: "block"; blockId: string };

export type DropData =
  | { kind: "section"; section: SectionId }
  | { kind: "row"; rowId: string }
  | { kind: "column"; columnId: string }
  | { kind: "block"; blockId: string };

/** An insertion slot: `index` counts positions in the list as it is now. */
export type DropHint = { kind: "row"; section: SectionId; index: number } | { kind: "block"; columnId: string; index: number } | null;

export const isRowDrag = (d: DragData): boolean => d.kind === "row" || d.kind === "palette-row";

/** Which droppable kinds a drag may target. */
export function acceptsDrop(drag: DragData, drop: DropData): boolean {
  return isRowDrag(drag) ? drop.kind === "row" || drop.kind === "section" : drop.kind === "block" || drop.kind === "column";
}

export function computeDropHint(
  content: DocumentTemplateContent,
  drag: DragData,
  drop: DropData | null,
  pointerY: number,
  overRect: { top: number; height: number },
): DropHint {
  if (!drop || !acceptsDrop(drag, drop)) return null;
  const after = pointerY > overRect.top + overRect.height / 2 ? 1 : 0;
  switch (drop.kind) {
    case "row": {
      const loc = findRow(content, drop.rowId);
      return loc ? { kind: "row", section: loc.section, index: loc.index + after } : null;
    }
    case "section":
      return { kind: "row", section: drop.section, index: content[drop.section].length };
    case "block": {
      const loc = findBlock(content, drop.blockId);
      if (!loc) return null;
      const col = content[loc.section][loc.rowIndex].columns[loc.colIndex];
      return { kind: "block", columnId: col.id, index: loc.blockIndex + after };
    }
    case "column": {
      const loc = findColumn(content, drop.columnId);
      if (!loc) return null;
      return { kind: "block", columnId: drop.columnId, index: content[loc.section][loc.rowIndex].columns[loc.colIndex].blocks.length };
    }
  }
}

/** Converts an insertion slot to a target index after removing the dragged item from the same list. */
export function slotToMoveIndex(fromIndexInSameList: number | null, slot: number): number {
  return fromIndexInSameList !== null && fromIndexInSameList < slot ? slot - 1 : slot;
}

type Actions = Pick<EditorState, "draft" | "addRow" | "moveRow" | "addBlock" | "moveBlock">;

export function applyDrop(state: Actions, drag: DragData, hint: DropHint): ActionResult {
  const content = state.draft?.content;
  if (!hint || !content) return { ok: true };
  if (hint.kind === "row") {
    if (drag.kind === "palette-row") return state.addRow(hint.section, drag.spans, hint.index);
    if (drag.kind === "row") {
      const from = findRow(content, drag.rowId);
      if (!from) return { ok: true };
      const same = from.section === hint.section ? from.index : null;
      return state.moveRow(drag.rowId, hint.section, slotToMoveIndex(same, hint.index));
    }
    return { ok: true };
  }
  if (drag.kind === "palette-block") return state.addBlock(drag.blockType, { columnId: hint.columnId, index: hint.index });
  if (drag.kind === "block") {
    const from = findBlock(content, drag.blockId);
    if (!from) return { ok: true };
    const fromCol = content[from.section][from.rowIndex].columns[from.colIndex];
    const same = fromCol.id === hint.columnId ? from.blockIndex : null;
    return state.moveBlock(drag.blockId, hint.columnId, slotToMoveIndex(same, hint.index));
  }
  return { ok: true };
}
