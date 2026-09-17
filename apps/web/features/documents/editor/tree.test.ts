import { describe, expect, it } from "vitest";
import type { DocumentTemplateContent, TextBlock } from "@bitcrm/types";
import { DEFAULT_DOCUMENT_VISIBILITY } from "@bitcrm/types";
import { DEFAULT_PAGE_SETTINGS, LIMITS, createBlock, createRow } from "@bitcrm/document-renderer";
import {
  EditorLimitError,
  addBlock,
  addRow,
  duplicateBlock,
  duplicateRow,
  findBlock,
  findColumn,
  findRow,
  moveBlock,
  moveRow,
  removeBlock,
  removeRow,
  setRowLayout,
  updateBlock,
  updateColumn,
  updateRow,
} from "./tree";

function content(): DocumentTemplateContent {
  const r1 = createRow([6, 6]);
  r1.id = "r1";
  r1.columns[0].id = "c1";
  r1.columns[1].id = "c2";
  r1.columns[0].blocks = [{ ...createBlock("logo"), id: "b1" }];
  r1.columns[1].blocks = [
    { ...createBlock("text"), id: "b2" },
    { ...createBlock("spacer"), id: "b3" },
  ];
  const r2 = createRow([12]);
  r2.id = "r2";
  r2.columns[0].id = "c3";
  r2.columns[0].blocks = [{ ...createBlock("itemsTable"), id: "b4" }];
  const f1 = createRow([12]);
  f1.id = "f1";
  f1.columns[0].id = "c4";
  return {
    page: { ...DEFAULT_PAGE_SETTINGS },
    header: [],
    body: [r1, r2],
    footer: [f1],
    visibility: { ...DEFAULT_DOCUMENT_VISIBILITY },
  };
}

describe("find helpers", () => {
  it("locates rows, columns and blocks across sections", () => {
    const c = content();
    expect(findRow(c, "f1")).toEqual({ section: "footer", index: 0 });
    expect(findColumn(c, "c2")).toEqual({ section: "body", rowIndex: 0, colIndex: 1 });
    expect(findBlock(c, "b3")).toEqual({ section: "body", rowIndex: 0, colIndex: 1, blockIndex: 1 });
    expect(findBlock(c, "nope")).toBeNull();
  });
});

describe("rows", () => {
  it("adds a row at an index without mutating the input", () => {
    const c = content();
    const { content: next, row } = addRow(c, "body", [4, 8], 1);
    expect(next.body.map((r) => r.id)).toEqual(["r1", row.id, "r2"]);
    expect(row.columns.map((col) => col.span)).toEqual([4, 8]);
    expect(c.body).toHaveLength(2);
    expect(next.footer).toBe(c.footer); // structural sharing
  });

  it("appends by default and enforces the rows-per-section limit", () => {
    const c = content();
    const { content: next } = addRow(c, "header", [12]);
    expect(next.header).toHaveLength(1);
    const full = { ...c, header: Array.from({ length: LIMITS.maxRowsPerSection }, () => createRow([12])) };
    expect(() => addRow(full, "header", [12])).toThrow(EditorLimitError);
  });

  it("moves a row within and across sections", () => {
    const c = content();
    expect(moveRow(c, "r2", "body", 0).body.map((r) => r.id)).toEqual(["r2", "r1"]);
    const across = moveRow(c, "r1", "footer", 1);
    expect(across.body.map((r) => r.id)).toEqual(["r2"]);
    expect(across.footer.map((r) => r.id)).toEqual(["f1", "r1"]);
  });

  it("updates row style and gap", () => {
    const next = updateRow(content(), "r1", { gap: 8, style: { background: "#fff" } });
    expect(next.body[0].gap).toBe(8);
    expect(next.body[0].style).toEqual({ background: "#fff" });
  });

  it("updates a column's span or alignment", () => {
    const next = updateColumn(content(), "c1", { verticalAlign: "middle" });
    expect(next.body[0].columns[0].verticalAlign).toBe("middle");
  });

  it("duplicates a row with fresh ids for the row, columns and blocks", () => {
    const { content: next, row } = duplicateRow(content(), "r1");
    expect(next.body.map((r) => r.id)).toEqual(["r1", row.id, "r2"]);
    expect(row.id).not.toBe("r1");
    expect(row.columns[0].id).not.toBe("c1");
    expect(row.columns[1].blocks.map((b) => b.type)).toEqual(["text", "spacer"]);
    expect(row.columns[1].blocks[0].id).not.toBe("b2");
  });

  it("removes a row", () => {
    expect(removeRow(content(), "r1").body.map((r) => r.id)).toEqual(["r2"]);
  });
});

describe("setRowLayout", () => {
  it("keeps blocks when the column count grows", () => {
    const next = setRowLayout(content(), "r2", [4, 4, 4]);
    const row = next.body[1];
    expect(row.columns.map((c) => c.span)).toEqual([4, 4, 4]);
    expect(row.columns[0].id).toBe("c3");
    expect(row.columns[0].blocks.map((b) => b.id)).toEqual(["b4"]);
    expect(row.columns[2].blocks).toEqual([]);
  });

  it("moves blocks of removed columns into the last remaining column", () => {
    const next = setRowLayout(content(), "r1", [12]);
    const row = next.body[0];
    expect(row.columns).toHaveLength(1);
    expect(row.columns[0].blocks.map((b) => b.id)).toEqual(["b1", "b2", "b3"]);
  });

  it("rejects spans that don't sum to 12", () => {
    expect(() => setRowLayout(content(), "r1", [6, 5])).toThrow(EditorLimitError);
  });

  it("rejects a merge that overflows the blocks-per-column limit", () => {
    const c = content();
    c.body[0].columns[0].blocks = Array.from({ length: LIMITS.maxBlocksPerColumn }, () => createBlock("spacer"));
    expect(() => setRowLayout(c, "r1", [12])).toThrow(EditorLimitError);
  });
});

describe("blocks", () => {
  it("adds a block into a column at an index", () => {
    const block = createBlock("divider");
    const next = addBlock(content(), "c2", block, 1);
    expect(next.body[0].columns[1].blocks.map((b) => b.id)).toEqual(["b2", block.id, "b3"]);
  });

  it("enforces the blocks-per-column limit", () => {
    const c = content();
    c.body[0].columns[0].blocks = Array.from({ length: LIMITS.maxBlocksPerColumn }, () => createBlock("spacer"));
    expect(() => addBlock(c, "c1", createBlock("text"))).toThrow(EditorLimitError);
  });

  it("moves a block within a column with arrayMove semantics", () => {
    const next = moveBlock(content(), "b2", "c2", 1);
    expect(next.body[0].columns[1].blocks.map((b) => b.id)).toEqual(["b3", "b2"]);
  });

  it("moves a block across columns and sections", () => {
    const next = moveBlock(content(), "b1", "c4", 0);
    expect(next.body[0].columns[0].blocks).toEqual([]);
    expect(next.footer[0].columns[0].blocks.map((b) => b.id)).toEqual(["b1"]);
  });

  it("is a no-op for unknown targets", () => {
    const c = content();
    expect(moveBlock(c, "b1", "missing", 0)).toBe(c);
    expect(moveBlock(c, "missing", "c1", 0)).toBe(c);
  });

  it("updates a block, merging style", () => {
    const c = content();
    c.body[0].columns[1].blocks[0].style = { color: "#000" };
    const next = updateBlock(c, "b2", { style: { align: "center" } });
    const b = next.body[0].columns[1].blocks[0] as TextBlock;
    expect(b.style).toEqual({ color: "#000", align: "center" });
    expect(b.type).toBe("text");
  });

  it("replaces style keys set to undefined", () => {
    const c = content();
    c.body[0].columns[1].blocks[0].style = { color: "#000" };
    const next = updateBlock(c, "b2", { style: { color: undefined } });
    expect(next.body[0].columns[1].blocks[0].style).toEqual({});
  });

  it("duplicates a block right after itself", () => {
    const { content: next, block } = duplicateBlock(content(), "b2");
    expect(next.body[0].columns[1].blocks.map((b) => b.id)).toEqual(["b2", block.id, "b3"]);
    expect(block.type).toBe("text");
  });

  it("removes a block", () => {
    expect(removeBlock(content(), "b2").body[0].columns[1].blocks.map((b) => b.id)).toEqual(["b3"]);
  });
});
