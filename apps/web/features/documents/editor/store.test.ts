import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentTemplate, TextBlock } from "@bitcrm/types";
import { LIMITS, createTemplateContent } from "@bitcrm/document-renderer";
import { HISTORY_LIMIT, createEditorStore, selectIsDirty } from "./store";

function template(extra: Partial<DocumentTemplate> = {}): DocumentTemplate {
  return {
    id: "t1",
    name: "Invoice",
    kind: "invoice",
    isDefault: false,
    version: 3,
    createdBy: "u",
    createdAt: "x",
    updatedAt: "x",
    ...createTemplateContent("invoice", "classic"),
    ...extra,
  };
}

let store: ReturnType<typeof createEditorStore>;
beforeEach(() => {
  store = createEditorStore();
  store.getState().load(template());
});
afterEach(() => vi.useRealTimers());

const s = () => store.getState();

describe("load", () => {
  it("starts clean with the template's version and no history", () => {
    expect(s().templateId).toBe("t1");
    expect(s().version).toBe(3);
    expect(s().draft?.name).toBe("Invoice");
    expect(s().draft?.autoApply).toEqual({ jobTypeIds: [], serviceAreaIds: [], businessProfileIds: [] });
    expect(selectIsDirty(s())).toBe(false);
    expect(s().past).toEqual([]);
    expect(s().draft?.content).not.toHaveProperty("id");
  });
});

describe("rows", () => {
  it("adds a row to a section, selects it and becomes dirty", () => {
    const res = s().addRow("footer", [6, 6]);
    expect(res.ok).toBe(true);
    const footer = s().draft!.content.footer;
    const row = footer[footer.length - 1];
    expect(row.columns.map((c) => c.span)).toEqual([6, 6]);
    expect(s().selection).toEqual({ type: "row", id: row.id });
    expect(s().activeSection).toBe("footer");
    expect(selectIsDirty(s())).toBe(true);
  });

  it("reports limit errors without changing the draft", () => {
    const before = s().draft;
    const res = s().addRow("body", [6, 5]);
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/add up to 12/) });
    expect(s().draft).toBe(before);
  });

  it("redistributes blocks when a layout shrinks", () => {
    const { content } = s().draft!;
    const row = content.header.find((r) => r.columns.length > 1)!;
    const all = row.columns.flatMap((c) => c.blocks.map((b) => b.id));
    expect(s().setRowLayout(row.id, [12]).ok).toBe(true);
    const next = s().draft!.content.header.find((r) => r.id === row.id)!;
    expect(next.columns[0].blocks.map((b) => b.id)).toEqual(all);
  });

  it("duplicates and removes rows, clearing a stale selection", () => {
    const rowId = s().draft!.content.body[0].id;
    s().duplicateRow(rowId);
    const copyId = s().draft!.content.body[1].id;
    expect(s().selection).toEqual({ type: "row", id: copyId });
    s().removeRow(copyId);
    expect(s().selection).toBeNull();
    expect(s().draft!.content.body[0].id).toBe(rowId);
  });

  it("moves rows between sections", () => {
    const rowId = s().draft!.content.body[0].id;
    s().moveRow(rowId, "footer", 0);
    expect(s().draft!.content.footer[0].id).toBe(rowId);
  });
});

describe("blocks", () => {
  it("inserts into the active column after the selected block", () => {
    const col = s().draft!.content.body[0].columns[0];
    s().select({ type: "block", id: col.blocks[0].id });
    expect(s().activeColumnId).toBe(col.id);
    s().addBlock("divider");
    const blocks = s().draft!.content.body[0].columns[0].blocks;
    expect(blocks[1].type).toBe("divider");
    expect(s().selection).toEqual({ type: "block", id: blocks[1].id });
  });

  it("creates a full-width row in the active section when no column is active", () => {
    s().select(null);
    s().setActiveSection("footer");
    const before = s().draft!.content.footer.length;
    s().addBlock("signature");
    const footer = s().draft!.content.footer;
    expect(footer).toHaveLength(before + 1);
    expect(footer[footer.length - 1].columns[0].blocks[0].type).toBe("signature");
  });

  it("inserts at an explicit target", () => {
    const col = s().draft!.content.footer[0].columns[0];
    s().addBlock("spacer", { columnId: col.id, index: 0 });
    expect(s().draft!.content.footer[0].columns[0].blocks[0].type).toBe("spacer");
  });

  it("rejects inserts past the per-column limit", () => {
    const col = s().draft!.content.footer[0].columns[0];
    for (let i = col.blocks.length; i < LIMITS.maxBlocksPerColumn; i++) {
      expect(s().addBlock("spacer", { columnId: col.id }).ok).toBe(true);
    }
    expect(s().addBlock("spacer", { columnId: col.id }).ok).toBe(false);
  });

  it("moves, duplicates and removes blocks", () => {
    const [c0] = s().draft!.content.body[0].columns;
    const blockId = c0.blocks[0].id;
    const target = s().draft!.content.footer[0].columns[0];
    s().moveBlock(blockId, target.id, 0);
    expect(s().draft!.content.footer[0].columns[0].blocks[0].id).toBe(blockId);
    s().duplicateBlock(blockId);
    expect(s().draft!.content.footer[0].columns[0].blocks[1].type).toBe(
      s().draft!.content.footer[0].columns[0].blocks[0].type,
    );
    s().select({ type: "block", id: blockId });
    s().removeBlock(blockId);
    expect(s().selection).toBeNull();
  });
});

describe("history", () => {
  it("undoes and redoes, returning to a clean state", () => {
    s().rename("Renamed");
    expect(selectIsDirty(s())).toBe(true);
    s().undo();
    expect(s().draft!.name).toBe("Invoice");
    expect(selectIsDirty(s())).toBe(false);
    s().redo();
    expect(s().draft!.name).toBe("Renamed");
    expect(s().future).toEqual([]);
  });

  it("clears redo after a new change", () => {
    s().rename("A");
    s().undo();
    s().rename("B");
    expect(s().future).toEqual([]);
  });

  it("coalesces rapid edits with the same key", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const block = s().draft!.content.header.flatMap((r) => r.columns.flatMap((c) => c.blocks)).find((b) => b.type === "text") as TextBlock;
    const doc = (t: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
    s().updateBlock(block.id, { content: doc("a") }, { coalesce: `text:${block.id}` });
    vi.setSystemTime(1_300);
    s().updateBlock(block.id, { content: doc("ab") }, { coalesce: `text:${block.id}` });
    vi.setSystemTime(1_600);
    s().updateBlock(block.id, { content: doc("abc") }, { coalesce: `text:${block.id}` });
    expect(s().past).toHaveLength(1);
    vi.setSystemTime(5_000);
    s().updateBlock(block.id, { content: doc("abcd") }, { coalesce: `text:${block.id}` });
    expect(s().past).toHaveLength(2);
    s().undo();
    s().undo();
    expect(selectIsDirty(s())).toBe(false);
  });

  it("does not coalesce different keys", () => {
    s().updatePage({ textColor: "#111111" }, { coalesce: "page:textColor" });
    s().updatePage({ accentColor: "#222222" }, { coalesce: "page:accentColor" });
    expect(s().past).toHaveLength(2);
  });

  it("caps history", () => {
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) s().rename(`Name ${i}`);
    expect(s().past).toHaveLength(HISTORY_LIMIT);
  });

  it("ignores no-op updates", () => {
    s().rename("Invoice");
    expect(s().past).toHaveLength(0);
  });
});

describe("document settings", () => {
  it("updates page, visibility and auto-apply", () => {
    s().updatePage({ size: "a4" });
    s().updateVisibility({ sku: true });
    s().updateAutoApply({ jobTypeIds: ["jt1"] });
    const d = s().draft!;
    expect(d.content.page.size).toBe("a4");
    expect(d.content.visibility.sku).toBe(true);
    expect(d.autoApply).toEqual({ jobTypeIds: ["jt1"], serviceAreaIds: [], businessProfileIds: [] });
  });

  it("replaces the layout with a preset but keeps visibility and name", () => {
    s().updateVisibility({ sku: true });
    s().loadPreset("minimal");
    const d = s().draft!;
    expect(d.content.visibility.sku).toBe(true);
    expect(d.name).toBe("Invoice");
    expect(d.content.body.length).toBeGreaterThan(0);
    expect(s().selection).toBeNull();
  });
});

describe("markSaved", () => {
  it("records the new version and the saved snapshot", () => {
    s().rename("Saved name");
    const draft = s().draft!;
    s().markSaved(4, draft);
    expect(s().version).toBe(4);
    expect(selectIsDirty(s())).toBe(false);
    // Undo past the save point makes it dirty again.
    s().undo();
    expect(selectIsDirty(s())).toBe(true);
  });

  it("stays dirty when edits happened after the snapshot was taken", () => {
    s().rename("A");
    const snapshot = s().draft!;
    s().rename("B");
    s().markSaved(4, snapshot);
    expect(selectIsDirty(s())).toBe(true);
  });
});
