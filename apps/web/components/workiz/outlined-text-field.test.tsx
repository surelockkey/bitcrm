import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WzOutlinedTextField } from "./outlined-text-field";

describe("WzOutlinedTextField — the text box of Workiz's newer modals", () => {
  it("is a textbox named by its label, which rests inside while empty and idle", () => {
    render(<WzOutlinedTextField label="Sub-status name" value="" onChange={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Sub-status name" });
    expect(box).toBeInTheDocument();
    expect(screen.getByText("Sub-status name")).toHaveAttribute("data-floated", "false");
  });

  it("lifts the label into the notch on focus or with a value", async () => {
    const { rerender } = render(<WzOutlinedTextField label="Name" value="" onChange={() => {}} />);
    await userEvent.click(screen.getByRole("textbox", { name: "Name" }));
    expect(screen.getByText("Name")).toHaveAttribute("data-floated", "true");
    rerender(<WzOutlinedTextField label="Name" value="Will Call Back" onChange={() => {}} />);
    await userEvent.tab();
    expect(screen.getByText("Name")).toHaveAttribute("data-floated", "true");
  });

  it("hands typed text to onChange and shows a helper line under the box", async () => {
    const onChange = vi.fn();
    render(<WzOutlinedTextField label="Name" value="" onChange={onChange} helper="Shown on the job" />);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "A");
    expect(onChange).toHaveBeenCalledWith("A");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveAccessibleDescription("Shown on the job");
  });
});
