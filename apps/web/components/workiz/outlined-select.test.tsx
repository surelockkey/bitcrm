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

  it("can point at the words that say why it is locked (the user page's User type)", () => {
    render(
      <>
        <span id="why">A manager sets this.</span>
        <WzOutlinedSelect label="User type" options={OPTIONS} value="t1" onChange={() => {}} disabled aria-describedby="why" />
      </>,
    );
    expect(screen.getByRole("combobox", { name: "User type" })).toHaveAccessibleDescription("A manager sets this.");
  });
});

describe("WzOutlinedSelect controlClassName (Add team member's +1 box)", () => {
  // subcontractor_wz_04_add_new_user: the same FloatingLabel shell drawn
  // 49px tall beside the 48px Phone box; the value stays on its middle.
  it("takes the box's own classes — its height — and keeps the value centred", () => {
    const { container } = render(
      <WzOutlinedSelect label="Country code" labelHidden options={[{ value: "US", label: "🇺🇸 +1" }]} value="US" onChange={() => {}} controlClassName="h-[49px]" />,
    );
    const anchor = [...container.querySelectorAll("div")].find((d) => d.className.includes("h-[49px]"));
    expect(anchor).toBeTruthy();
    expect(anchor?.className).not.toContain("h-[42px]");
    const value = screen.getByText("🇺🇸 +1");
    expect(value.className).toContain("top-1/2");
    expect(value.className).toContain("-translate-y-1/2");
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
