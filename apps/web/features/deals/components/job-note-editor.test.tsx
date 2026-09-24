import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { JobNoteEditor } from "./job-note-editor";

/**
 * The job note as Workiz writes it: a toolbar over the box — the block format,
 * undo and redo, bold and italic, the two lists, and a link — and the note
 * itself below.
 *
 * What matters beyond the buttons is the boundary: 79,708 imported notes are
 * plain text, and they have to open as paragraphs rather than one run-on line.
 */
const note = "#George / NP\nIgnition cylinder Change";

describe("JobNoteEditor", () => {
  it("offers what Workiz's toolbar offers", () => {
    render(<JobNoteEditor value="" onChange={vi.fn()} />);

    for (const name of ["Undo", "Redo", "Bold", "Italic", "Bullet list", "Numbered list", "Link"]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("opens an imported plain-text note as paragraphs, not as one line", () => {
    const { container } = render(<JobNoteEditor value={note} onChange={vi.fn()} />);

    const paragraphs = container.querySelectorAll(".ProseMirror p");
    expect(paragraphs.length).toBeGreaterThanOrEqual(2);
    expect(paragraphs[0].textContent).toBe("#George / NP");
  });

  it("names itself, so the field is reachable by name", () => {
    render(<JobNoteEditor value="" onChange={vi.fn()} ariaLabel="Notes" />);
    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
  });

  it("shows a placeholder while the note is empty", () => {
    const { container } = render(<JobNoteEditor value="" onChange={vi.fn()} />);
    expect(container.querySelector("[data-placeholder]")).not.toBeNull();
  });

  it("is read-only when the viewer may not edit", () => {
    const { container } = render(<JobNoteEditor value={note} onChange={vi.fn()} editable={false} />);

    expect(container.querySelector(".ProseMirror")?.getAttribute("contenteditable")).toBe("false");
    expect(screen.queryByRole("button", { name: "Bold" })).toBeNull();
  });
});
