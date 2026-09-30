import { describe, expect, it } from "vitest";
import { emptyDoc, isEmptyDoc, sanitizeRichText } from "./rich-text";

describe("sanitizeRichText", () => {
  it("keeps allowed nodes/marks and strips TipTap's extra attrs", () => {
    const input = {
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", text: "Hi" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://x.io", target: "_blank", rel: "noopener", class: null } }] },
            { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "#f00", fontSize: null } }] },
            { type: "mergeTag", attrs: { path: "client.fullName", label: "x" } },
            { type: "hardBreak" },
          ],
        },
        { type: "orderedList", attrs: { start: 1, type: null }, content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
      ],
    };
    expect(sanitizeRichText(input)).toEqual({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Hi" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
            { type: "text", text: "link", marks: [{ type: "link", attrs: { href: "https://x.io" } }] },
            { type: "text", text: "red", marks: [{ type: "textStyle", attrs: { color: "#f00" } }] },
            { type: "mergeTag", attrs: { path: "client.fullName" } },
            { type: "hardBreak" },
          ],
        },
        { type: "orderedList", content: [{ type: "listItem", content: [{ type: "paragraph" }] }] },
      ],
    });
  });

  it("drops unknown nodes and marks, and textStyle without a color", () => {
    const out = sanitizeRichText({
      type: "doc",
      content: [
        { type: "blockquote", content: [{ type: "paragraph" }] },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "x", marks: [{ type: "strike" }, { type: "textStyle", attrs: { color: null } }] },
            { type: "image", attrs: { src: "x" } },
          ],
        },
      ],
    });
    expect(out).toEqual({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x" }] }] });
  });

  it("always returns a doc with at least one paragraph", () => {
    expect(sanitizeRichText(null)).toEqual(emptyDoc());
    expect(sanitizeRichText({ type: "doc", content: [] })).toEqual(emptyDoc());
  });

  it("drops empty mergeTag paths and empty text nodes", () => {
    const out = sanitizeRichText({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "mergeTag", attrs: {} }, { type: "text", text: "" }] }],
    });
    expect(out).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});

describe("isEmptyDoc", () => {
  it("detects docs without text or tags", () => {
    expect(isEmptyDoc(emptyDoc())).toBe(true);
    expect(isEmptyDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "mergeTag", attrs: { path: "today" } }] }] })).toBe(false);
  });
});
