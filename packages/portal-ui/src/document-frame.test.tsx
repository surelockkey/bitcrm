import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DocumentFrame, prepareDocumentHtml } from "./document-frame";

const HTML = "<!doctype html><html><head><title>Invoice 1</title></head><body><div class='paper'>Hi</div></body></html>";

describe("prepareDocumentHtml", () => {
  it("makes links open outside the frame", () => {
    const out = prepareDocumentHtml(HTML, false);
    expect(out).toContain('<head><base target="_blank">');
    expect(out).not.toContain("<style>");
  });

  it("adds the phone reader CSS only when compact", () => {
    const out = prepareDocumentHtml(HTML, true);
    expect(out).toContain('<base target="_blank"><style>');
    expect(out).toContain(".col{grid-column:1 / -1 !important}");
    expect(out.indexOf("<style>")).toBeLessThan(out.indexOf("<title>"));
  });

  it("copes with a fragment that has no <head>", () => {
    expect(prepareDocumentHtml("<p>x</p>", true).startsWith('<base target="_blank"><style>')).toBe(true);
  });
});

describe("DocumentFrame", () => {
  it("renders the document in a script-less sandboxed frame", () => {
    render(<DocumentFrame html={HTML} title="Invoice #1" />);
    const frame = screen.getByTitle("Invoice #1");
    expect(frame.tagName).toBe("IFRAME");
    const sandbox = frame.getAttribute("sandbox") ?? "";
    expect(sandbox).toContain("allow-same-origin");
    expect(sandbox).not.toContain("allow-scripts");
    expect(frame.getAttribute("srcdoc")).toContain("Invoice 1");
  });
});
