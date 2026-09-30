import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealNotesCard } from "./deal-notes-card";

/**
 * The job's note, the way Workiz shows it: one box inside the Job section,
 * with no heading and no label of its own.
 *
 * It used to be a card titled "Notes" holding a field titled "Job note" —
 * three names for one thing. The second, dispatcher-only box was ours alone
 * besides: Workiz's equivalent is a custom field the team made themselves
 * ("Manager Note", in their Dispatchers group), and ours was empty on all
 * 80,034 imported jobs.
 */
const props = {
  notes: "#14ST/ needs to make a key for safe",
  onNotesChange: vi.fn(),
};

describe("DealNotesCard", () => {
  it("is one field under one name", () => {
    render(<DealNotesCard {...props} editable />);

    expect(screen.getByText("Notes")).toBeInTheDocument();
    // Not a card called Notes holding a field called Job note: one name.
    expect(screen.queryByText("Job note")).toBeNull();
    expect(screen.queryByText("Dispatcher note")).toBeNull();
  });

  it("is written in, with the toolbar Workiz has", () => {
    render(<DealNotesCard {...props} editable />);

    expect(screen.getByLabelText("Notes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bold" })).toBeInTheDocument();
  });

  it("holds the job's text", () => {
    const { container } = render(<DealNotesCard {...props} editable />);
    expect(container.querySelector(".ProseMirror")?.textContent).toContain("needs to make a key for safe");
  });

  it("shows the note to someone who cannot edit it", () => {
    render(<DealNotesCard {...props} editable={false} />);
    expect(screen.getByText(/needs to make a key for safe/)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("still says what it is when there is no note yet", () => {
    render(<DealNotesCard notes="" editable={false} onNotesChange={vi.fn()} />);
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows a stored rich-text note as words, never as tags", () => {
    render(<DealNotesCard notes="<p>Ignition <strong>change</strong></p>" editable={false} onNotesChange={vi.fn()} />);
    expect(screen.getByText("Ignition change")).toBeInTheDocument();
  });
});
