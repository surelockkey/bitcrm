import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WzColorDots } from "./color-dots";

const OPTIONS = [
  { value: "red", label: "Red", color: "#e35a36" },
  { value: "blue", label: "Blue", className: "bg-blue-token" },
  { value: "green", label: "Green", color: "#6d960c" },
];

describe("WzColorDots — Workiz's Choose color", () => {
  it("is a radio group of named dots with the chosen one checked", () => {
    render(<WzColorDots label="Choose color" options={OPTIONS} value="blue" onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Choose color" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Blue" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Red" })).not.toBeChecked();
    // The heading over the dots is drawn too.
    expect(screen.getByText("Choose color")).toBeInTheDocument();
  });

  it("picks on a click and moves with the arrow keys", async () => {
    const onChange = vi.fn();
    render(<WzColorDots label="Choose color" options={OPTIONS} value="red" onChange={onChange} />);
    await userEvent.click(screen.getByRole("radio", { name: "Green" }));
    expect(onChange).toHaveBeenLastCalledWith("green");

    screen.getByRole("radio", { name: "Red" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("blue");
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("red");
    // and wraps round from the first to the last
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("green");
  });

  it("draws the chosen dot as a ring round a smaller dot, Workiz's way", () => {
    render(<WzColorDots label="c" options={OPTIONS} value="red" onChange={() => {}} />);
    // 24px of the colour, white from 1px in, the colour again from 4px in:
    // a 1px coloured edge round a white ring round a 16px dot.
    const red = screen.getByRole("radio", { name: "Red" });
    expect(red).toHaveStyle({ backgroundColor: "#e35a36" });
    expect(red.querySelector("[data-slot=wz-color-dot-ring]")).not.toBeNull();
    expect(red.querySelector("[data-slot=wz-color-dot-inner]")).toHaveStyle({ backgroundColor: "#e35a36" });
    const green = screen.getByRole("radio", { name: "Green" });
    expect(green.querySelector("[data-slot=wz-color-dot-ring]")).toBeNull();
  });

  it("draws Workiz's older square swatches with a ✓ on the chosen one (Add New Service area)", () => {
    render(<WzColorDots label="Choose Color" shape="square" options={OPTIONS} value="red" onChange={() => {}} />);
    const red = screen.getByRole("radio", { name: "Red" });
    expect(red.className).toMatch(/rounded-\[2px\]/);
    expect(red.querySelector("[data-slot=wz-color-square-check]")).not.toBeNull();
    expect(screen.getByRole("radio", { name: "Green" }).querySelector("[data-slot=wz-color-square-check]")).toBeNull();
  });

  it("only the chosen dot is a tab stop", () => {
    render(<WzColorDots label="c" options={OPTIONS} value="green" onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Green" })).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: "Red" })).toHaveAttribute("tabindex", "-1");
  });
});
