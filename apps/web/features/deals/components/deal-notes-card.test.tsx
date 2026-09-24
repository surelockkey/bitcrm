import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealNotesCard } from "./deal-notes-card";

/**
 * One note, the way Workiz has it. The second, "dispatcher-only" box was ours
 * alone: Workiz's equivalent is a custom field the team made themselves
 * ("Manager Note", in their Dispatchers group), and our own field was empty on
 * all 80,034 imported jobs. Two boxes only made people wonder which one the
 * job note was.
 */
const props = {
  notes: "#14ST/ needs to make a key for safe",
  onNotesChange: vi.fn(),
};

describe("DealNotesCard", () => {
  it("names the job's note the way Workiz does", () => {
    render(<DealNotesCard {...props} editable />);
    expect(screen.getByText("Job note")).toBeInTheDocument();
  });

  it("offers one box, not two", () => {
    const { container } = render(<DealNotesCard {...props} editable />);
    expect(container.querySelectorAll("textarea")).toHaveLength(1);
    expect(screen.queryByText("Dispatcher note")).toBeNull();
  });

  it("shows the note to someone who cannot edit it", () => {
    render(<DealNotesCard {...props} editable={false} />);
    expect(screen.getByText("Job note")).toBeInTheDocument();
    expect(screen.getByText(/needs to make a key for safe/)).toBeInTheDocument();
  });

  it("holds the job's text", () => {
    render(<DealNotesCard {...props} editable />);
    expect(screen.getByLabelText("Job note")).toHaveValue(props.notes);
  });
});
