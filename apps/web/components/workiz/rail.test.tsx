import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { History, SquarePen } from "lucide-react";

import { WzRail, WzRailButton, WzRailPanel } from "./rail";

describe("WzRail", () => {
  it("is the 55px strip with the ← cap; its buttons are icons with a red count", async () => {
    const onExpand = vi.fn();
    const onNotes = vi.fn();
    render(
      <WzRail aria-label="Job rail" onExpand={onExpand}>
        <WzRailButton icon={History} label="Timeline" onClick={() => {}} />
        <WzRailButton icon={SquarePen} label="Notes" badge="6" onClick={onNotes} />
      </WzRail>,
    );
    const rail = screen.getByRole("toolbar", { name: "Job rail" });
    expect(rail.className).toContain("w-[55px]");
    await userEvent.click(screen.getByRole("button", { name: "Expand panel" }));
    expect(onExpand).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Notes (6)" }));
    expect(onNotes).toHaveBeenCalled();
    expect(screen.getByText("6").className).toContain("bg-wz-danger");
  });

  it("can carry Workiz's client-page captions under the icons", () => {
    render(
      <WzRail aria-label="Client rail">
        <WzRailButton icon={SquarePen} label="Notes" caption onClick={() => {}} />
      </WzRail>,
    );
    expect(screen.getByText("Notes").className).toContain("text-[11px]");
  });

  it("marks the open panel's button (Workiz's #f3f6f7 tile) and says it is pressed", () => {
    render(
      <WzRail aria-label="Client rail">
        <WzRailButton icon={SquarePen} label="Notes" caption active onClick={() => {}} />
        <WzRailButton icon={History} label="History" caption onClick={() => {}} />
      </WzRail>,
    );
    expect(screen.getByRole("button", { name: "Notes" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Notes" }).className).toContain("bg-wz-secondary-hover");
    expect(screen.getByRole("button", { name: "History" })).not.toHaveAttribute("aria-pressed");
  });
});

describe("WzRailPanel", () => {
  it("is the 350px panel with its 62px grey head, → to close and the title centred", async () => {
    const onClose = vi.fn();
    render(
      <WzRailPanel aria-label="Job timeline" title="Timeline" onClose={onClose}>
        body
      </WzRailPanel>,
    );
    const panel = screen.getByRole("complementary", { name: "Job timeline" });
    expect(panel.className).toContain("w-[350px]");
    expect(screen.getByRole("heading", { name: "Timeline" }).className).toContain("font-semibold");
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("plain: the client page's white panel — the title at the left, × at the right", async () => {
    const onClose = vi.fn();
    render(
      <WzRailPanel variant="plain" aria-label="Notes" title="Notes" onClose={onClose}>
        body
      </WzRailPanel>,
    );
    const heading = screen.getByRole("heading", { name: "Notes" });
    expect(heading.className).toContain("text-[18px]");
    expect(heading.className).not.toContain("text-center");
    await userEvent.click(screen.getByRole("button", { name: "Close panel" }));
    expect(onClose).toHaveBeenCalled();
  });
});
