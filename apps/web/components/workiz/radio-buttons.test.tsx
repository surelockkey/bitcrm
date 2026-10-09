import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzRadioButtons } from "./radio-buttons";

const TYPES = [
  { value: "regular", label: "User" },
  { value: "subcontractor", label: "Subcontractor" },
] as const;

const cls = (el: Element) => el.className.toString().split(/\s+/);

describe("WzRadioButtons", () => {
  it("is a radio group with the chosen one checked", () => {
    render(<WzRadioButtons aria-label="User type" options={TYPES} value="subcontractor" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "User type" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Subcontractor" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "User" })).not.toBeChecked();
  });

  // subcontractor_wz_04b_add_new_subcontractor: div._btnRadio 1px #ddd, r4, 38px;
  // each div._btnRadioBtn flex-1, 14px/16px 400 #404040, 10px padding; _selected #ffd400.
  it("draws Workiz's _btnRadio: a #ddd frame, equal halves, the chosen one yellow", () => {
    render(<WzRadioButtons aria-label="User type" options={TYPES} value="subcontractor" onChange={() => {}} />);
    const group = screen.getByRole("radiogroup");
    expect(cls(group)).toEqual(expect.arrayContaining(["flex", "rounded-[4px]", "border", "border-wz-frame"]));
    const on = screen.getByRole("radio", { name: "Subcontractor" });
    const off = screen.getByRole("radio", { name: "User" });
    expect(cls(on)).toEqual(expect.arrayContaining(["flex-1", "p-2.5", "text-[14px]", "leading-4", "bg-[#ffd400]"]));
    expect(cls(off)).not.toContain("bg-[#ffd400]");
  });

  it("chooses on click and with the arrow keys", async () => {
    const onChange = vi.fn();
    render(<WzRadioButtons aria-label="User type" options={TYPES} value="regular" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Subcontractor" }));
    expect(onChange).toHaveBeenLastCalledWith("subcontractor");

    screen.getByRole("radio", { name: "User" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("subcontractor");
  });

  it("takes one Tab stop: the chosen one", () => {
    render(<WzRadioButtons aria-label="User type" options={TYPES} value="subcontractor" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Subcontractor" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "User" })).toHaveAttribute("tabindex", "-1");
  });
});
