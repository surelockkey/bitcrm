import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WzOnOffSwitch } from "./on-off-switch";

describe("WzOnOffSwitch — Workiz's ON / OFF react-switch", () => {
  it("is a switch that reads ON when on and OFF when off", () => {
    const { rerender } = render(<WzOnOffSwitch checked onCheckedChange={() => {}} aria-label="Lockout status" />);
    const sw = screen.getByRole("switch", { name: "Lockout status" });
    expect(sw).toBeChecked();
    expect(sw.closest("label")).toHaveTextContent("ON");

    rerender(<WzOnOffSwitch checked={false} onCheckedChange={() => {}} aria-label="Lockout status" />);
    expect(screen.getByRole("switch", { name: "Lockout status" })).not.toBeChecked();
    expect(screen.getByRole("switch").closest("label")).toHaveTextContent("OFF");
  });

  it("asks for the other state on a click or Space, and leaves the drawing to the caller", async () => {
    const onChange = vi.fn();
    render(<WzOnOffSwitch checked onCheckedChange={onChange} aria-label="s" />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(false);
    screen.getByRole("switch").focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("does nothing while disabled", async () => {
    const onChange = vi.fn();
    render(<WzOnOffSwitch checked={false} disabled onCheckedChange={onChange} aria-label="s" />);
    await userEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("keeps a click on it from opening the row it sits in", async () => {
    const onRow = vi.fn();
    render(
      <div onClick={onRow}>
        <WzOnOffSwitch checked onCheckedChange={() => {}} aria-label="s" />
      </div>,
    );
    await userEvent.click(screen.getByRole("switch"));
    expect(onRow).not.toHaveBeenCalled();
  });
});
