import { describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import type { RichTextNode } from "@bitcrm/types";
import { useEditorUi } from "../ui-store";
import { RichTextEditor } from "./rich-text-editor";
import { RichTextStatic } from "./rich-text-static";

const doc: RichTextNode = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Invoice" }] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Hi " },
        { type: "mergeTag", attrs: { path: "client.fullName" } },
        { type: "text", text: " bold", marks: [{ type: "bold" }] },
        { type: "text", text: " red", marks: [{ type: "textStyle", attrs: { color: "#ff0000" } }] },
        { type: "text", text: " link", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
      ],
    },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] }] },
  ],
};

describe("RichTextStatic", () => {
  it("renders nodes, marks and merge-tag chips", () => {
    const { container } = render(<RichTextStatic node={doc} />);
    expect(screen.getByRole("heading", { level: 2, name: "Invoice" })).toBeInTheDocument();
    expect(screen.getByText("Full name")).toHaveClass("merge-chip");
    expect(screen.getByText("bold", { exact: false }).tagName).toBe("STRONG");
    expect(screen.getByText("red", { exact: false })).toHaveStyle({ color: "#ff0000" });
    // Unsafe links render as plain text.
    expect(container.querySelector("a")).toBeNull();
    expect(screen.getByRole("listitem")).toHaveTextContent("one");
  });

  it("shows a placeholder for an empty doc", () => {
    render(<RichTextStatic node={{ type: "doc", content: [{ type: "paragraph" }] }} placeholder="Empty text" />);
    expect(screen.getByText("Empty text")).toBeInTheDocument();
  });
});

describe("RichTextEditor", () => {
  it("renders merge tags as chips and emits allow-listed JSON", async () => {
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor value={doc} onChange={onChange} ariaLabel="Text block" />);
    await waitFor(() => expect(container.querySelector("[data-merge-tag='client.fullName']")).not.toBeNull());
    expect(container.querySelector("[data-merge-tag='client.fullName']")).toHaveTextContent("Full name");

    const editor = useEditorUi.getState().textEditor;
    expect(editor).not.toBeNull();
    act(() => {
      editor!.chain().focus("end").insertMergeTag("document.number").run();
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const json = onChange.mock.calls.at(-1)![0] as RichTextNode;
    expect(JSON.stringify(json)).toContain(JSON.stringify({ type: "mergeTag", attrs: { path: "document.number" } }));
    expect(JSON.stringify(json)).toContain(JSON.stringify({ type: "mergeTag", attrs: { path: "client.fullName" } }));
    // TipTap's extra attrs (link target/rel…) are stripped.
    expect(JSON.stringify(json)).not.toContain("target");
  });

  it("syncs external value changes without emitting", async () => {
    const onChange = vi.fn();
    const { rerender, container } = render(<RichTextEditor value={doc} onChange={onChange} ariaLabel="Text block" />);
    await waitFor(() => expect(container.textContent).toContain("Invoice"));
    rerender(
      <RichTextEditor
        value={{ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Replaced" }] }] }}
        onChange={onChange}
        ariaLabel="Text block"
      />,
    );
    await waitFor(() => expect(container.textContent).toContain("Replaced"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("unregisters itself on unmount", async () => {
    const { unmount } = render(<RichTextEditor value={doc} onChange={() => {}} ariaLabel="Text block" />);
    await waitFor(() => expect(useEditorUi.getState().textEditor).not.toBeNull());
    unmount();
    expect(useEditorUi.getState().textEditor).toBeNull();
  });
});
