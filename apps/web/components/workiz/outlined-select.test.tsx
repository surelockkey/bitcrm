import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzOutlinedSelect } from "./outlined-select";

const OPTIONS = [
  { value: "t1", label: "Sam Reyes" },
  { value: "t2", label: "Nia Holt" },
];

describe("WzOutlinedSelect — the notched select of Workiz's newer forms (Add time off)", () => {
  it("is a combobox named by its label, showing the placeholder until something is picked", () => {
    render(<WzOutlinedSelect label="Select user" placeholder="Select user" options={OPTIONS} value="" onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Select user" })).toBeInTheDocument();
    expect(screen.getByText("Select user", { selector: "[data-slot=wz-outlined-placeholder]" })).toBeInTheDocument();
  });

  it("floats its label into the notch when it has a placeholder or a value, and rests inside otherwise", () => {
    const { rerender } = render(<WzOutlinedSelect label="Reason" options={OPTIONS} value="" onChange={() => {}} />);
    expect(screen.getByText("Reason").closest("label")).toHaveAttribute("data-floated", "false");
    rerender(<WzOutlinedSelect label="Reason" options={OPTIONS} value="t1" onChange={() => {}} />);
    expect(screen.getByText("Reason").closest("label")).toHaveAttribute("data-floated", "true");
    expect(screen.getByText("Sam Reyes")).toBeInTheDocument();
  });

  it("lists every option, the chosen one included, and reports the pick", async () => {
    const onChange = vi.fn();
    render(<WzOutlinedSelect label="Select user" options={OPTIONS} value="t1" onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Select user" }));
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["Sam Reyes", "Nia Holt"]);
    await userEvent.click(screen.getByRole("option", { name: "Nia Holt" }));
    expect(onChange).toHaveBeenCalledWith("t2");
  });

  it("shows an error under the box", () => {
    render(<WzOutlinedSelect label="Select user" options={OPTIONS} value="" onChange={() => {}} error="Pick a technician" />);
    expect(screen.getByText("Pick a technician")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Select user" })).toHaveAttribute("aria-invalid", "true");
  });
});

describe("WzOutlinedSelect labelHidden (pg_pricebook)", () => {
  it("names the box without drawing the label — Workiz's catalog status box shows only its value", () => {
    render(<WzOutlinedSelect label="Status" labelHidden options={OPTIONS} value="t1" onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("Status").className).toContain("sr-only");
    expect(screen.getByText("Status").closest("label")).not.toHaveAttribute("data-floated");
    expect(screen.getByText("Sam Reyes")).toBeInTheDocument();
  });
});
