import { describe, expect, it } from "vitest";
import type { DocumentTemplateSummary } from "@bitcrm/types";
import { ApiError } from "@/lib/api/errors";
import {
  ROW_LAYOUTS,
  autoApplySummary,
  blockStyleToCss,
  groupTemplatesByKind,
  isVersionConflict,
  mergeTagsForKind,
  rendererCanvasCss,
  scopeCss,
  spansLabel,
} from "./lib";

const summary = (id: string, extra: Partial<DocumentTemplateSummary> = {}): DocumentTemplateSummary => ({
  id,
  name: id,
  kind: "invoice",
  isDefault: false,
  version: 1,
  updatedAt: "2026-01-01",
  ...extra,
});

describe("groupTemplatesByKind", () => {
  it("groups in kind order with the default first, then by name", () => {
    const groups = groupTemplatesByKind([
      summary("b"),
      summary("a"),
      summary("z", { isDefault: true }),
      summary("e", { kind: "estimate" }),
      summary("c", { kind: "custom" }),
    ]);
    expect(groups.map((g) => [g.kind, g.label, g.templates.map((t) => t.id)])).toEqual([
      ["invoice", "Invoices", ["z", "a", "b"]],
      ["estimate", "Estimates", ["e"]],
      ["custom", "Custom documents", ["c"]],
    ]);
  });
});

describe("autoApplySummary", () => {
  const names = {
    jobTypes: new Map([["j1", "Rekey"]]),
    serviceAreas: new Map([["s1", "North"], ["s2", "South"]]),
    companies: new Map([["bp-2", "KeyPro"]]),
  };
  it("describes matching rules", () => {
    expect(autoApplySummary(undefined, names)).toBeNull();
    expect(autoApplySummary({ jobTypeIds: [], serviceAreaIds: [] }, names)).toBeNull();
    expect(autoApplySummary({ jobTypeIds: ["j1"] }, names)).toBe("Auto-applies to Rekey");
    expect(autoApplySummary({ jobTypeIds: ["j1", "jx"], serviceAreaIds: ["s1", "s2"] }, names)).toBe(
      "Auto-applies to Rekey, 1 more job type · North, South",
    );
    expect(autoApplySummary({ businessProfileIds: ["bp-2"], jobTypeIds: ["j1"] }, names)).toBe(
      "Auto-applies to Rekey · KeyPro",
    );
  });
});

describe("isVersionConflict", () => {
  it("is true only for 409 API errors", () => {
    expect(isVersionConflict(new ApiError(409, "conflict"))).toBe(true);
    expect(isVersionConflict(new ApiError(400, "bad"))).toBe(false);
    expect(isVersionConflict(new Error("x"))).toBe(false);
  });
});

describe("ROW_LAYOUTS", () => {
  it("lists valid layouts", () => {
    for (const l of ROW_LAYOUTS) expect(l.spans.reduce((a, b) => a + b, 0)).toBe(12);
    expect(ROW_LAYOUTS.map((l) => spansLabel(l.spans))).toEqual(["12", "6/6", "4/8", "8/4", "4/4/4", "3/3/3/3"]);
  });
});

describe("mergeTagsForKind", () => {
  it("filters by kind and search, grouped", () => {
    const custom = mergeTagsForKind("custom", "");
    expect(custom.some((g) => g.tags.some((t) => t.path === "totals.total"))).toBe(false);
    const search = mergeTagsForKind("invoice", "due");
    expect(search.flatMap((g) => g.tags.map((t) => t.path))).toEqual(
      expect.arrayContaining(["document.dueDate", "totals.balanceDue"]),
    );
    expect(search.every((g) => g.tags.length > 0)).toBe(true);
  });
});

describe("blockStyleToCss", () => {
  it("maps validated style to React CSS", () => {
    expect(
      blockStyleToCss({ align: "center", color: "#ff0000", fontSize: 200, fontWeight: "bold", paddingTop: 4, borderWidth: 2, borderColor: "#000", borderRadius: 3 }),
    ).toEqual({
      textAlign: "center",
      color: "#ff0000",
      fontSize: "96px",
      fontWeight: 700,
      paddingTop: "4px",
      border: "2px solid #000",
      borderRadius: "3px",
    });
    expect(blockStyleToCss({ color: "javascript:alert(1)" })).toEqual({});
    expect(blockStyleToCss(undefined)).toEqual({});
  });
});

describe("scopeCss", () => {
  it("prefixes selectors and maps root/html/body to the scope", () => {
    const css = ":root{--a:1}\nhtml,body{margin:0}\n.row{display:grid}\np{margin:0}\n.blk + .blk{margin-top:6px}\n@page { size: A4; }";
    expect(scopeCss(css, ".s")).toBe(".s{--a:1}\n.s{margin:0}\n.s .row{display:grid}\n.s p{margin:0}\n.s .blk + .blk{margin-top:6px}");
  });

  it("extracts the renderer's screen CSS for the canvas", () => {
    const css = rendererCanvasCss({ size: "a4", fontFamily: "Georgia" } as never, ".doc-canvas");
    expect(css).toContain(".doc-canvas .row{");
    expect(css).toContain("Georgia");
    expect(css).toContain("210mm");
    expect(css).not.toMatch(/(^|\n)body/);
  });

  it("finds the renderer's web font", async () => {
    const { rendererFontHref } = await import("./lib");
    expect(rendererFontHref({ fontFamily: "Inter" } as never)).toMatch(/^https:\/\/fonts\.googleapis\.com\/css2\?family=Inter.*&display=swap$/);
    expect(rendererFontHref({ fontFamily: "Georgia" } as never)).toBeNull();
  });
});

describe("collectAssetIds", () => {
  it("finds image asset ids in every section", async () => {
    const { collectAssetIds } = await import("./lib");
    const row = (blocks: unknown[]) => ({ id: "r", columns: [{ id: "c", span: 12, blocks }] });
    const content = {
      header: [row([{ id: "1", type: "image", assetId: "a1", widthPercent: 100 }])],
      body: [row([{ id: "2", type: "image", widthPercent: 100 }, { id: "3", type: "logo", maxHeight: 40 }])],
      footer: [row([{ id: "4", type: "image", assetId: "a2", widthPercent: 50 }])],
    } as never;
    expect(collectAssetIds(content)).toEqual(["a1", "a2"]);
    expect(collectAssetIds(undefined)).toEqual([]);
  });
});
