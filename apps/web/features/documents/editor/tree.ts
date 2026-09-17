/**
 * Immutable operations on a template's rows → columns → blocks tree. Every
 * function returns a new content object that shares untouched branches with
 * the input (cheap memoization downstream) and throws {@link EditorLimitError}
 * when an operation would break the renderer's `LIMITS`.
 */
import type {
  BlockStyle,
  DocumentBlock,
  DocumentColumn,
  DocumentRow,
  DocumentTemplateContent,
} from "@bitcrm/types";
import { LIMITS, createRow, newId } from "@bitcrm/document-renderer";

export type SectionId = "header" | "body" | "footer";
export const SECTIONS: SectionId[] = ["header", "body", "footer"];

export class EditorLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EditorLimitError";
  }
}

export interface RowLocation {
  section: SectionId;
  index: number;
}
export interface ColumnLocation {
  section: SectionId;
  rowIndex: number;
  colIndex: number;
}
export interface BlockLocation extends ColumnLocation {
  blockIndex: number;
}

/* ------------------------------------------------------------------ find */

export function findRow(content: DocumentTemplateContent, rowId: string): RowLocation | null {
  for (const section of SECTIONS) {
    const index = content[section].findIndex((r) => r.id === rowId);
    if (index >= 0) return { section, index };
  }
  return null;
}

export function findColumn(content: DocumentTemplateContent, columnId: string): ColumnLocation | null {
  for (const section of SECTIONS) {
    const rows = content[section];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const colIndex = rows[rowIndex].columns.findIndex((c) => c.id === columnId);
      if (colIndex >= 0) return { section, rowIndex, colIndex };
    }
  }
  return null;
}

export function findBlock(content: DocumentTemplateContent, blockId: string): BlockLocation | null {
  for (const section of SECTIONS) {
    const rows = content[section];
    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const cols = rows[rowIndex].columns;
      for (let colIndex = 0; colIndex < cols.length; colIndex++) {
        const blockIndex = cols[colIndex].blocks.findIndex((b) => b.id === blockId);
        if (blockIndex >= 0) return { section, rowIndex, colIndex, blockIndex };
      }
    }
  }
  return null;
}

export function getBlock(content: DocumentTemplateContent, blockId: string): DocumentBlock | null {
  const loc = findBlock(content, blockId);
  return loc ? content[loc.section][loc.rowIndex].columns[loc.colIndex].blocks[loc.blockIndex] : null;
}

export function getRow(content: DocumentTemplateContent, rowId: string): DocumentRow | null {
  const loc = findRow(content, rowId);
  return loc ? content[loc.section][loc.index] : null;
}

/** The row + column holding a block. */
export function getBlockParents(
  content: DocumentTemplateContent,
  blockId: string,
): { row: DocumentRow; column: DocumentColumn; section: SectionId } | null {
  const loc = findBlock(content, blockId);
  if (!loc) return null;
  const row = content[loc.section][loc.rowIndex];
  return { row, column: row.columns[loc.colIndex], section: loc.section };
}

/* ------------------------------------------------------------ primitives */

function withSection(content: DocumentTemplateContent, section: SectionId, rows: DocumentRow[]): DocumentTemplateContent {
  return { ...content, [section]: rows };
}

function mapColumn(
  content: DocumentTemplateContent,
  columnId: string,
  fn: (col: DocumentColumn) => DocumentColumn,
): DocumentTemplateContent {
  const loc = findColumn(content, columnId);
  if (!loc) return content;
  const rows = [...content[loc.section]];
  const row = rows[loc.rowIndex];
  const columns = [...row.columns];
  columns[loc.colIndex] = fn(columns[loc.colIndex]);
  rows[loc.rowIndex] = { ...row, columns };
  return withSection(content, loc.section, rows);
}

function insertAt<T>(list: T[], item: T, index?: number): T[] {
  const next = [...list];
  const at = index === undefined ? next.length : Math.max(0, Math.min(index, next.length));
  next.splice(at, 0, item);
  return next;
}

function assertRowRoom(content: DocumentTemplateContent, section: SectionId) {
  if (content[section].length >= LIMITS.maxRowsPerSection) {
    throw new EditorLimitError(`A section can hold at most ${LIMITS.maxRowsPerSection} rows.`);
  }
}

function assertBlockRoom(count: number) {
  if (count > LIMITS.maxBlocksPerColumn) {
    throw new EditorLimitError(`A column can hold at most ${LIMITS.maxBlocksPerColumn} blocks.`);
  }
}

export function validateSpans(spans: number[]): void {
  if (!spans.length || spans.length > LIMITS.maxColumnsPerRow) {
    throw new EditorLimitError(`A row needs 1–${LIMITS.maxColumnsPerRow} columns.`);
  }
  if (spans.some((s) => !Number.isInteger(s) || s < 1 || s > 12)) {
    throw new EditorLimitError("Column widths must be whole numbers from 1 to 12.");
  }
  const sum = spans.reduce((a, b) => a + b, 0);
  if (sum !== 12) throw new EditorLimitError(`Column widths must add up to 12 (now ${sum}).`);
}

/** Deep copy of a block with a fresh id. */
export function cloneBlock(block: DocumentBlock): DocumentBlock {
  return { ...structuredClone(block), id: newId() };
}

function cloneRow(row: DocumentRow): DocumentRow {
  const copy = structuredClone(row);
  return {
    ...copy,
    id: newId(),
    columns: copy.columns.map((c) => ({ ...c, id: newId(), blocks: c.blocks.map(cloneBlock) })),
  };
}

/* ------------------------------------------------------------------ rows */

export function addRow(
  content: DocumentTemplateContent,
  section: SectionId,
  spans: number[],
  index?: number,
): { content: DocumentTemplateContent; row: DocumentRow } {
  validateSpans(spans);
  assertRowRoom(content, section);
  const row = createRow(spans);
  return { content: withSection(content, section, insertAt(content[section], row, index)), row };
}

/** Moves a row to `toIndex` of `toSection` (index in the list after removal). */
export function moveRow(
  content: DocumentTemplateContent,
  rowId: string,
  toSection: SectionId,
  toIndex: number,
): DocumentTemplateContent {
  const loc = findRow(content, rowId);
  if (!loc) return content;
  if (loc.section === toSection && loc.index === toIndex) return content;
  if (loc.section !== toSection) assertRowRoom(content, toSection);
  const row = content[loc.section][loc.index];
  const source = content[loc.section].filter((r) => r.id !== rowId);
  const removed = withSection(content, loc.section, source);
  return withSection(removed, toSection, insertAt(removed[toSection], row, toIndex));
}

export type RowPatch = Partial<Pick<DocumentRow, "gap" | "style">>;

export function updateRow(content: DocumentTemplateContent, rowId: string, patch: RowPatch): DocumentTemplateContent {
  const loc = findRow(content, rowId);
  if (!loc) return content;
  const rows = [...content[loc.section]];
  const row = rows[loc.index];
  const next: DocumentRow = { ...row };
  if ("gap" in patch) next.gap = patch.gap;
  if (patch.style) next.style = mergeStyle(row.style, patch.style);
  rows[loc.index] = next;
  return withSection(content, loc.section, rows);
}

export type ColumnPatch = Partial<Pick<DocumentColumn, "verticalAlign" | "span">>;

export function updateColumn(content: DocumentTemplateContent, columnId: string, patch: ColumnPatch): DocumentTemplateContent {
  return mapColumn(content, columnId, (col) => ({ ...col, ...patch }));
}

/**
 * Re-shapes a row. Existing columns keep their id and blocks by position;
 * blocks of columns that no longer exist move to the end of the last column.
 */
export function setRowLayout(content: DocumentTemplateContent, rowId: string, spans: number[]): DocumentTemplateContent {
  validateSpans(spans);
  const loc = findRow(content, rowId);
  if (!loc) return content;
  const rows = [...content[loc.section]];
  const row = rows[loc.index];
  const kept = row.columns.slice(0, spans.length);
  const orphans = row.columns.slice(spans.length).flatMap((c) => c.blocks);
  const fresh = createRow(spans).columns;
  const columns = spans.map((span, i) => (kept[i] ? { ...kept[i], span } : fresh[i]));
  if (orphans.length) {
    const last = columns[columns.length - 1];
    const blocks = [...last.blocks, ...orphans];
    assertBlockRoom(blocks.length);
    columns[columns.length - 1] = { ...last, blocks };
  }
  rows[loc.index] = { ...row, columns };
  return withSection(content, loc.section, rows);
}

export function duplicateRow(
  content: DocumentTemplateContent,
  rowId: string,
): { content: DocumentTemplateContent; row: DocumentRow } {
  const loc = findRow(content, rowId);
  if (!loc) throw new EditorLimitError("Row not found.");
  assertRowRoom(content, loc.section);
  const row = cloneRow(content[loc.section][loc.index]);
  return { content: withSection(content, loc.section, insertAt(content[loc.section], row, loc.index + 1)), row };
}

export function removeRow(content: DocumentTemplateContent, rowId: string): DocumentTemplateContent {
  const loc = findRow(content, rowId);
  if (!loc) return content;
  return withSection(
    content,
    loc.section,
    content[loc.section].filter((r) => r.id !== rowId),
  );
}

/* ---------------------------------------------------------------- blocks */

export function addBlock(
  content: DocumentTemplateContent,
  columnId: string,
  block: DocumentBlock,
  index?: number,
): DocumentTemplateContent {
  return mapColumn(content, columnId, (col) => {
    assertBlockRoom(col.blocks.length + 1);
    return { ...col, blocks: insertAt(col.blocks, block, index) };
  });
}

/**
 * Moves a block into `toColumnId` at `toIndex`. The index is interpreted in the
 * target list *after* the block was removed (arrayMove semantics).
 */
export function moveBlock(
  content: DocumentTemplateContent,
  blockId: string,
  toColumnId: string,
  toIndex: number,
): DocumentTemplateContent {
  const from = findBlock(content, blockId);
  if (!from || !findColumn(content, toColumnId)) return content;
  const fromCol = content[from.section][from.rowIndex].columns[from.colIndex];
  if (fromCol.id === toColumnId && from.blockIndex === toIndex) return content;
  const block = fromCol.blocks[from.blockIndex];
  const removed = mapColumn(content, fromCol.id, (col) => ({ ...col, blocks: col.blocks.filter((b) => b.id !== blockId) }));
  return addBlock(removed, toColumnId, block, toIndex);
}

/** A loose partial for any block type; `style` is merged key by key. */
export type BlockPatch = { [key: string]: unknown; style?: BlockStyle };

export function mergeStyle(base: BlockStyle | undefined, patch: BlockStyle): BlockStyle {
  const out: Record<string, unknown> = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete out[k];
    else out[k] = v;
  }
  return out as BlockStyle;
}

export function updateBlock(content: DocumentTemplateContent, blockId: string, patch: BlockPatch): DocumentTemplateContent {
  const loc = findBlock(content, blockId);
  if (!loc) return content;
  const col = content[loc.section][loc.rowIndex].columns[loc.colIndex];
  return mapColumn(content, col.id, (c) => {
    const blocks = [...c.blocks];
    const current = blocks[loc.blockIndex];
    const { style, ...rest } = patch;
    const next = { ...current, ...rest, id: current.id, type: current.type } as DocumentBlock;
    if (style) next.style = mergeStyle(current.style, style);
    blocks[loc.blockIndex] = next;
    return { ...c, blocks };
  });
}

export function duplicateBlock(
  content: DocumentTemplateContent,
  blockId: string,
): { content: DocumentTemplateContent; block: DocumentBlock } {
  const loc = findBlock(content, blockId);
  if (!loc) throw new EditorLimitError("Block not found.");
  const col = content[loc.section][loc.rowIndex].columns[loc.colIndex];
  const block = cloneBlock(col.blocks[loc.blockIndex]);
  return { content: addBlock(content, col.id, block, loc.blockIndex + 1), block };
}

export function removeBlock(content: DocumentTemplateContent, blockId: string): DocumentTemplateContent {
  const loc = findBlock(content, blockId);
  if (!loc) return content;
  const col = content[loc.section][loc.rowIndex].columns[loc.colIndex];
  return mapColumn(content, col.id, (c) => ({ ...c, blocks: c.blocks.filter((b) => b.id !== blockId) }));
}
