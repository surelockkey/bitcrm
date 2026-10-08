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

  it("names its trigger as told", () => {
    render(<WzActionsMenu label="More" items={[{ key: "a", label: "A", onSelect: () => {} }]} />);
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });
});
