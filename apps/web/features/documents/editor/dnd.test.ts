import { beforeEach, describe, expect, it } from "vitest";
import type { DocumentTemplate } from "@bitcrm/types";
import { createTemplateContent } from "@bitcrm/document-renderer";
import { applyDrop, computeDropHint, isRowDrag, slotToMoveIndex, type DragData } from "./dnd";
import { createEditorStore } from "./store";

let store: ReturnType<typeof createEditorStore>;
beforeEach(() => {
  store = createEditorStore();
  store.getState().load({
    id: "t",
    name: "T",
    kind: "invoice",
    isDefault: false,
    version: 1,
    createdBy: "u",
    createdAt: "x",
    updatedAt: "x",
    ...createTemplateContent("invoice", "classic"),
  } as DocumentTemplate);
});
const content = () => store.getState().draft!.content;
const rect = { top: 100, height: 40 };

describe("slotToMoveIndex", () => {
  it("accounts for the removed item when moving down in the same list", () => {
    expect(slotToMoveIndex(1, 3)).toBe(2);
    expect(slotToMoveIndex(3, 1)).toBe(1);
    expect(slotToMoveIndex(null, 4)).toBe(4);
  });
});

describe("computeDropHint", () => {
  it("places rows before/after the hovered row by pointer position", () => {
    const rows = content().body;
    const drag: DragData = { kind: "palette-row", spans: [12] };
    expect(computeDropHint(content(), drag, { kind: "row", rowId: rows[2].id }, 110, rect)).toEqual({ kind: "row", section: "body", index: 2 });
    expect(computeDropHint(content(), drag, { kind: "row", rowId: rows[2].id }, 130, rect)).toEqual({ kind: "row", section: "body", index: 3 });
  });

  it("appends rows when dropped on a section", () => {
    const drag: DragData = { kind: "row", rowId: content().body[0].id };
    expect(computeDropHint(content(), drag, { kind: "section", section: "footer" }, 0, rect)).toEqual({
      kind: "row",
      section: "footer",
      index: content().footer.length,
    });
  });

  it("places blocks around the hovered block or at the end of a column", () => {
    const col = content().footer[0].columns[0];
    const drag: DragData = { kind: "palette-block", blockType: "text" };
    expect(computeDropHint(content(), drag, { kind: "block", blockId: col.blocks[1].id }, 125, rect)).toEqual({
      kind: "block",
      columnId: col.id,
      index: 2,
    });
    expect(computeDropHint(content(), drag, { kind: "column", columnId: col.id }, 0, rect)).toEqual({
      kind: "block",
      columnId: col.id,
      index: col.blocks.length,
    });
  });

  it("ignores mismatched targets", () => {
    const drag: DragData = { kind: "palette-block", blockType: "text" };
    expect(computeDropHint(content(), drag, { kind: "section", section: "body" }, 0, rect)).toBeNull();
    expect(computeDropHint(content(), { kind: "palette-row", spans: [12] }, { kind: "column", columnId: "x" }, 0, rect)).toBeNull();
    expect(computeDropHint(content(), drag, null, 0, rect)).toBeNull();
  });
});

describe("applyDrop", () => {
  it("adds a palette row at the slot", () => {
    const res = applyDrop(store.getState(), { kind: "palette-row", spans: [4, 8] }, { kind: "row", section: "header", index: 0 });
    expect(res.ok).toBe(true);
    expect(content().header[0].columns.map((c) => c.span)).toEqual([4, 8]);
  });

  it("moves a row down within its section", () => {
    const [a, b, c] = content().body;
    applyDrop(store.getState(), { kind: "row", rowId: a.id }, { kind: "row", section: "body", index: 3 });
    expect(content().body.slice(0, 3).map((r) => r.id)).toEqual([b.id, c.id, a.id]);
  });

  it("inserts a palette block at the slot and selects it", () => {
    const col = content().footer[0].columns[0];
    applyDrop(store.getState(), { kind: "palette-block", blockType: "spacer" }, { kind: "block", columnId: col.id, index: 1 });
    const blocks = content().footer[0].columns[0].blocks;
    expect(blocks[1].type).toBe("spacer");
    expect(store.getState().selection).toEqual({ type: "block", id: blocks[1].id });
  });

  it("moves a block down within its column", () => {
    const col = content().footer[0].columns[0];
    const [first, second] = col.blocks;
    applyDrop(store.getState(), { kind: "block", blockId: first.id }, { kind: "block", columnId: col.id, index: 2 });
    expect(content().footer[0].columns[0].blocks.map((b) => b.id)).toEqual([second.id, first.id]);
  });

  it("moves a block into another column", () => {
    const from = content().footer[0].columns[0];
    const to = content().header[0].columns[0];
    applyDrop(store.getState(), { kind: "block", blockId: from.blocks[0].id }, { kind: "block", columnId: to.id, index: 0 });
    expect(content().header[0].columns[0].blocks[0].id).toBe(from.blocks[0].id);
  });

  it("does nothing without a hint", () => {
    const before = content();
    expect(applyDrop(store.getState(), { kind: "palette-row", spans: [12] }, null).ok).toBe(true);
    expect(content()).toBe(before);
  });
});

describe("isRowDrag", () => {
  it("classifies drags", () => {
    expect(isRowDrag({ kind: "row", rowId: "x" })).toBe(true);
    expect(isRowDrag({ kind: "palette-block", blockType: "text" })).toBe(false);
  });
});
