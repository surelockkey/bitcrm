import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ThumbsUp, Trash2 } from "lucide-react";

import { WzActionsMenu } from "./menu";

describe("WzActionsMenu", () => {
  it("is the job page's Actions ▾ pill opening Workiz's menu, with its little caret", async () => {
    const done = vi.fn();
    const del = vi.fn();
    render(
      <WzActionsMenu
        items={[
          { key: "done", label: "Job Done", icon: ThumbsUp, onSelect: done },
          { key: "delete", label: "Delete Job", icon: Trash2, onSelect: del },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger.className).toContain("rounded-pill");
    expect(trigger.className).toContain("border-foreground");
    await userEvent.click(trigger);
    expect(screen.getAllByRole("menuitem").map((i) => i.textContent)).toEqual(["Job Done", "Delete Job"]);
    expect(document.querySelector("[data-slot=wz-menu-caret]")).not.toBeNull();
    await userEvent.click(screen.getByRole("menuitem", { name: "Delete Job" }));
    expect(del).toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
  });

  // job_b_02_actions_open: Workiz's wfi-down is an 18px thin chevron before
  // the word (audit_pixels J3); the caret is a 14×7 notch under the middle
  // of the pill (the zoomed capture, apex at x≈1312 under the 1254–1362
  // pill — not at the panel's right end as audit J5 guessed). Rows are
  // 50px, and the ruled ones 51 — the rule adds to the row.
  it("draws Workiz's 18px thin chevron before the word, a 14×7 caret under the pill's middle, rows ruled 51px", async () => {
    render(
      <WzActionsMenu
        items={[
          { key: "a", label: "A", onSelect: () => {} },
          { key: "b", label: "B", onSelect: () => {} },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    const chevron = trigger.querySelector("svg")!;
    expect(chevron.getAttribute("class")).toContain("size-[18px]");
    expect(chevron.getAttribute("stroke-width")).toBe("1.25");
    await userEvent.click(trigger);
    const caret = document.querySelector("[data-slot=wz-menu-caret]")!;
    expect(caret.getAttribute("width")).toBe("14");
    expect(caret.getAttribute("height")).toBe("7");
    expect(screen.getAllByRole("menuitem")[1].className).not.toMatch(/(^|\s)h-\[50px\]/);
  });

  it("names its trigger as told", () => {
    render(<WzActionsMenu label="More" items={[{ key: "a", label: "A", onSelect: () => {} }]} />);
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });
});
