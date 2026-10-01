import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { CategoryField, FloatingInput, WzSelect, WzToggle } from "./wz";

function Input({ alwaysFloat = false, initial = "" }: { alwaysFloat?: boolean; initial?: string }) {
  const [v, setV] = useState(initial);
  return <FloatingInput label="Re-order at" value={v} onChange={setV} alwaysFloat={alwaysFloat} />;
}

const label = () => screen.getByText("Re-order at", { selector: "label" });

describe("FloatingInput", () => {
  it("empty, the label stands in as the placeholder; focus or a value lifts it to the top edge", async () => {
    const user = userEvent.setup();
    render(<Input />);
    expect(label()).not.toHaveAttribute("data-floated");
    expect(label()).toHaveClass("top-[15.2px]");
    await user.click(screen.getByLabelText("Re-order at"));
    expect(label()).toHaveAttribute("data-floated");
    await user.type(screen.getByLabelText("Re-order at"), "4");
    await user.tab();
    expect(label()).toHaveAttribute("data-floated");
    expect(label()).toHaveClass("top-[2px]");
  });

  it("alwaysFloat keeps the label up on an empty field (Workiz does it for the item's own fields)", () => {
    render(<Input alwaysFloat />);
    expect(label()).toHaveAttribute("data-floated");
  });

  it("is a 48px box that never grows sideways", () => {
    render(<Input initial={"x".repeat(500)} />);
    const input = screen.getByLabelText("Re-order at");
    expect(input).toHaveClass("h-12", "w-full", "min-w-0");
  });
});

describe("WzSelect", () => {
  it("with a value: its label on top, × clears it; empty: the placeholder and no ×", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <WzSelect
        label="Select brand (optional)"
        placeholder="Select brand (optional)"
        value="b1"
        options={[{ value: "b1", label: "SLK" }]}
        onChange={onChange}
        clearable
      />,
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("Select brand (optional)SLK");
    await user.click(screen.getByRole("button", { name: "Clear Select brand (optional)" }));
    expect(onChange).toHaveBeenCalledWith("");

    rerender(
      <WzSelect
        label="Select brand (optional)"
        placeholder="Select brand (optional)"
        value=""
        options={[{ value: "b1", label: "SLK" }]}
        onChange={onChange}
        clearable
      />,
    );
    expect(screen.getByRole("combobox")).toHaveTextContent("Select brand (optional)");
    expect(screen.queryByRole("button", { name: /^Clear/ })).not.toBeInTheDocument();
  });
});

describe("WzToggle", () => {
  it("is a switch that flips", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<WzToggle label="Taxable item" checked onChange={onChange} />);
    const sw = screen.getByRole("switch", { name: "Taxable item" });
    expect(sw).toHaveAttribute("aria-checked", "true");
    expect(sw).toHaveClass("h-5", "w-10", "bg-[#50d58c]");
    await user.click(sw);
    expect(onChange).toHaveBeenCalledWith(false);
  });
});

describe("CategoryField", () => {
  it("empty: the label inside; set: the label on the border over the name; Browse or the field opens the picker", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn();
    const { rerender } = render(<CategoryField label="Choose category (optional)" value="" onBrowse={onBrowse} />);
    expect(screen.getAllByText("Choose category (optional)")).toHaveLength(1);
    await user.click(screen.getByTestId("category-field"));
    rerender(<CategoryField label="Choose category (optional)" value="Door Hardware" onBrowse={onBrowse} />);
    expect(screen.getByText("Choose category (optional)")).toHaveClass("-top-2");
    expect(screen.getByText("Door Hardware")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Browse — Choose category (optional)" }));
    expect(onBrowse).toHaveBeenCalledTimes(2);
  });
});
