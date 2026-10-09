import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Download } from "lucide-react";
import { WzLegacyActionsMenu } from "./legacy-actions-menu";

/**
 * Workiz's legacy document page "Actions ⌄" (the work order view,
 * pg_workorders_wz_05_5TU7ZA_actions_open): `button _clear min90` — 34px,
 * white, 1px #ccc, 15px corners, 13px/600 #666, the chevron after the word —
 * opening `_popActions`: 216px, the job page's shadow and caret, 50px rows of
 * 14px #666 ruled #ccc, a glyph before each.
 */
describe("WzLegacyActionsMenu", () => {
  it("is a button named by its word, opening one row per action", async () => {
    const download = vi.fn();
    render(
      <WzLegacyActionsMenu
        items={[
          { key: "download", label: "Download", icon: Download, onSelect: download },
          { key: "sign", label: "Upload file", onSelect: vi.fn(), disabled: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    await userEvent.click(trigger);
    const rows = screen.getAllByRole("menuitem");
    expect(rows.map((r) => r.textContent)).toEqual(["Download", "Upload file"]);
    expect(rows[1]).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(rows[0]);
    expect(download).toHaveBeenCalledOnce();
  });

  it("draws the _clear button: 34px, white, #ccc edge, 15px corners, 13px/600 #666, chevron last", () => {
    render(<WzLegacyActionsMenu items={[{ key: "a", label: "A", onSelect: vi.fn() }]} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    for (const c of ["h-[34px]", "rounded-[15px]", "border-input", "bg-background", "text-[13px]", "font-semibold", "text-wz-text"]) {
      expect(trigger.className).toContain(c);
    }
    expect(trigger.lastElementChild?.tagName.toLowerCase()).toBe("svg");
  });

  it("draws _popActions: 216px with the caret, 50px #666 rows ruled #ccc", async () => {
    render(
      <WzLegacyActionsMenu
        items={[
          { key: "a", label: "A", onSelect: vi.fn() },
          { key: "b", label: "B", onSelect: vi.fn() },
        ]}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    const panel = screen.getByRole("menu");
    expect(panel.className).toContain("w-[216px]");
    expect(panel.className).toContain("border-input");
    expect(panel.querySelector("[data-slot=wz-menu-caret]")).not.toBeNull();
    for (const row of screen.getAllByRole("menuitem")) {
      expect(row.className).toContain("h-[50px]");
      expect(row.className).toContain("text-wz-text");
    }
  });

  it("paints a destructive row red", async () => {
    render(<WzLegacyActionsMenu items={[{ key: "del", label: "Delete", onSelect: vi.fn(), destructive: true }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    expect(screen.getByRole("menuitem")).toHaveAttribute("data-variant", "destructive");
  });
});
