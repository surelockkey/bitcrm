import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DealNotesCard } from "./deal-notes-card";

/**
 * The job's own note is what Workiz calls the job note, and what dispatchers
 * ask for by that name. Labelled just "Note" beside "Dispatcher note", it read
 * as if only the dispatcher one existed — people looked for the job note on
 * the card and did not find it.
 */
const props = {
  notes: "#14ST/ needs to make a key for safe",
  internalNotes: "",
  onNotesChange: vi.fn(),
  onInternalNotesChange: vi.fn(),
};

describe("DealNotesCard", () => {
  it("names the job's own note the way Workiz does", () => {
    render(<DealNotesCard {...props} editable />);
    expect(screen.getByText("Job note")).toBeInTheDocument();
  });

  it("keeps the dispatcher's internal note distinct", () => {
    render(<DealNotesCard {...props} editable />);
    expect(screen.getByText("Dispatcher note")).toBeInTheDocument();
  });

  it("shows the job note to someone who cannot edit it", () => {
    render(<DealNotesCard {...props} editable={false} />);
    expect(screen.getByText("Job note")).toBeInTheDocument();
    expect(screen.getByText(/needs to make a key for safe/)).toBeInTheDocument();
  });

  it("puts the job's text in the job note, not in the dispatcher one", () => {
    render(<DealNotesCard {...props} editable />);
    expect(screen.getByLabelText("Job note")).toHaveValue(props.notes);
    expect(screen.getByLabelText("Dispatcher note")).toHaveValue("");
  });
});
