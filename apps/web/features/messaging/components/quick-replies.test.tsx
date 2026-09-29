import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { QuickReplies } from "./quick-replies";

vi.mock("../hooks", () => ({
  useTemplates: () => ({
    data: [
      { id: "t1", messageTemplateTitle: "Pictures request" },
      { id: "t2", messageTemplateTitle: "Signature request" },
      { id: "t3", messageTemplateTitle: "Complaint response" },
    ],
  }),
}));

vi.mock("./template-picker", () => ({
  TemplatePicker: () => <div data-testid="template-picker" />,
}));

function chips(): HTMLElement[] {
  const row = screen.getByLabelText("Quick replies");
  return Array.from(row.querySelectorAll("button"));
}

describe("the quick-reply chips", () => {
  it("shows one chip per template", () => {
    render(<QuickReplies channel="sms" onPick={vi.fn()} />);
    expect(chips()).toHaveLength(3);
    expect(screen.getByText("Pictures request")).toBeInTheDocument();
  });

  it("reads blue but quiet — a tinted pill, not a row of saturated outlines", () => {
    // Workiz outlines these in #6aa8ee, which is 2.49:1 on white — too faint
    // to keep as a label colour. A pale blue fill carries the blue instead,
    // and the label sits in a deep blue that clears AA on that tint (5.6:1).
    render(<QuickReplies channel="sms" onPick={vi.fn()} />);
    for (const chip of chips()) {
      expect(chip.className).toContain("bg-accent");
      expect(chip.className).toContain("text-info-text");
      expect(chip.className).toContain("border-brand/25");
      // Not the full-strength accent that made the row shout.
      expect(chip.className).not.toContain("text-brand");
      expect(chip.className).not.toContain("border-brand/50");
    }
  });
});
