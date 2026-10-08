import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { JobTabBar } from "./job-tab-bar";

const sublabels = {
  details: "(A-1) Door Service",
  items: "$455.98",
  payments: "$224.62 balance",
  estimates: "1 estimate",
  attachments: "2 attachments",
  invoice: "No invoice",
} as const;

function renderBar() {
  render(
    <JobTabBar
      tabs={["details", "items", "payments", "estimates", "attachments", "invoice"]}
      active="details"
      onSelect={vi.fn()}
      sublabels={sublabels}
    />,
  );
}

// Workiz never cuts a tab's grey line: with the Timeline open its tabs give up
// the ninth-of-the-width and shrink to their text plus 18px a side
// (rail_chat: "Payments" 395–486, "Estimates" from 522), so "$224.62 balance"
// stays whole. Ours cut it to "$224.62 bala…" when the panel narrowed the bar.
describe("JobTabBar", () => {
  it("never truncates a tab's grey line", () => {
    renderBar();
    const sub = screen.getByText("$224.62 balance");
    expect(sub.className).not.toMatch(/\btruncate\b/);
    expect(sub.className).toMatch(/\bwhitespace-nowrap\b/);
  });

  it("lets a tab grow to its text plus Workiz's 18px a side instead of clipping", () => {
    renderBar();
    const tab = screen.getByRole("tab", { name: "Payments" });
    expect(tab.className).toMatch(/\bmin-w-max\b/);
    expect(tab.className).toMatch(/\bpx-\[18px\]/);
    expect(tab.className).not.toMatch(/\bmin-w-\[112px\]/);
  });
});
