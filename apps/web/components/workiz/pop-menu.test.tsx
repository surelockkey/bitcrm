import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzPopMenu } from "./pop-menu";

/**
 * Workiz's "Actions ⌄" on the user page (pg_technicians_wz_13_actions_open):
 * a 40px outline pill, the words then the chevron, opening the legacy
 * `_popMenu` — 245px, 16px corners, 50px rows of 13px ink, no rules.
 */
describe("WzPopMenu", () => {
  it("is a button named by its words, opening one menu item per action", async () => {
    const reset = vi.fn();
    render(
      <WzPopMenu
        items={[
          { key: "text", label: "Send a text", onSelect: reset },
          { key: "off", label: "Disable user", onSelect: vi.fn(), disabled: true },
        ]}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger.className).toContain("rounded-pill");
    await userEvent.click(trigger);
    const items = screen.getAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Send a text", "Disable user"]);
    expect(items[1]).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(items[0]);
    expect(reset).toHaveBeenCalledOnce();
  });

  it("puts the chevron after the words, as the user page draws it", () => {
    render(<WzPopMenu items={[{ key: "a", label: "A", onSelect: vi.fn() }]} />);
    const trigger = screen.getByRole("button", { name: "Actions" });
    expect(trigger.lastElementChild?.tagName.toLowerCase()).toBe("svg");
  });

  it("draws the _popMenu panel: 245px, 16px corners, 50px rows without rules", async () => {
    render(<WzPopMenu items={[{ key: "a", label: "A", onSelect: vi.fn() }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Actions" }));
    const panel = screen.getByRole("menu");
    expect(panel.className).toContain("w-[245px]");
    expect(panel.className).toContain("rounded-[16px]");
    expect(screen.getByRole("menuitem").className).toContain("h-[50px]");
  });
});
