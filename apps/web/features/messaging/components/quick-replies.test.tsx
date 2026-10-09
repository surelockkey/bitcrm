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

  it("draws Workiz's chips: #6aa8ee words in a #6aa8ee outline, r4, 32px", () => {
    // 2026-10-08 the owner asked for the inbox identical to Workiz, colours
    // included (pg_messages_wz_07_thread_client: 13px/16px 500 rgb(106,168,238),
    // 1px solid the same, r4, 8px 12px). The earlier pale-fill variant, kept
    // for contrast (#6aa8ee is 2.49:1 on white), is gone; the report flags it.
    render(<QuickReplies channel="sms" onPick={vi.fn()} />);
    for (const chip of chips()) {
      expect(chip.className).toContain("text-wz-link");
      expect(chip.className).toContain("border-wz-link");
      expect(chip.className).toContain("h-8");
      expect(chip.className).toContain("rounded-[4px]");
      expect(chip.className).not.toContain("bg-accent");
    }
  });
});
