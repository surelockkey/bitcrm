import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzDotsMenu } from "./dots-menu";

/**
 * Workiz's ••• on a card (pg_automations_wz_12_dots_open): three dots in a
 * 40×20 box opening the legacy `_popMenu` — 175px, 16px corners, 37px rows
 * of 16px ink, Delete in red.
 */
describe("WzDotsMenu", () => {
  it("is a button named by its caller, drawn as three dots", () => {
    render(<WzDotsMenu aria-label="Actions for Rule" items={[{ key: "a", label: "A", onSelect: vi.fn() }]} />);
    const trigger = screen.getByRole("button", { name: "Actions for Rule" });
    expect(trigger.className).toContain("w-10");
    expect(trigger.className).toContain("h-5");
    expect(trigger.querySelectorAll("span")).toHaveLength(3);
  });

  it("opens one row per item and runs the one picked", async () => {
    const edit = vi.fn();
    render(
      <WzDotsMenu
        aria-label="Actions"
        items={[
          { key: "edit", label: "Edit", onSelect: edit },
          { key: "delete", label: "Delete", onSelect: vi.fn(), destructive: true, "aria-label": "Delete Rule" },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    const panel = screen.getByRole("menu");
    expect(panel.className).toContain("w-[175px]");
    expect(panel.className).toContain("rounded-[16px]");
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Edit", "Delete"]);
    expect(rows[0].className).toContain("h-[37px]");
    expect(screen.getByRole("menuitem", { name: "Delete Rule" })).toHaveAttribute("data-variant", "destructive");
    await userEvent.click(rows[0]);
    expect(edit).toHaveBeenCalledOnce();
  });

  it("says under a disabled row why it is disabled", async () => {
    render(
      <WzDotsMenu
        aria-label="Actions"
        items={[{ key: "delete", label: "Delete", onSelect: vi.fn(), disabled: true, note: "Turned off, not deleted." }]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem", { name: "Delete" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Turned off, not deleted.")).toBeInTheDocument();
  });
});
