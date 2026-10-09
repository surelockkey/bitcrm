import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzWideSwitch } from "./wide-switch";

/**
 * Workiz's old react-switch (User locations' "Restricted",
 * pg_inventory_wz_02_user-locations): a 130×24 bar, the word in capitals on
 * it, the 30px knob at the left — yellow with the knob at the right when on.
 */
describe("WzWideSwitch", () => {
  it("is a switch named by its label, saying No while off", () => {
    render(<WzWideSwitch label="Restricted for Ann" checked={false} onCheckedChange={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Restricted for Ann" });
    expect(sw).toHaveAttribute("aria-checked", "false");
    expect(sw).toHaveTextContent("No");
  });

  it("says Yes on #eac300 with the knob moved 100px when on", () => {
    render(<WzWideSwitch label="Restricted" checked onCheckedChange={() => {}} />);
    const sw = screen.getByRole("switch", { name: "Restricted" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(sw).toHaveTextContent("Yes");
    expect(sw.className).toContain("bg-[#eac300]");
    expect(sw.querySelector("[data-slot=wz-wide-switch-knob]")!.className).toContain("translate-x-[100px]");
  });

  it("flips on a click", async () => {
    const onCheckedChange = vi.fn();
    render(<WzWideSwitch label="Restricted" checked={false} onCheckedChange={onCheckedChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Restricted" }));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does nothing while disabled", async () => {
    const onCheckedChange = vi.fn();
    render(<WzWideSwitch label="Restricted" checked={false} disabled onCheckedChange={onCheckedChange} />);
    const sw = screen.getByRole("switch", { name: "Restricted" });
    expect(sw).toBeDisabled();
    await userEvent.click(sw);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
