import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Table2 } from "lucide-react";

import { WzListToolbar, WzPageSizeSelect, WzSearchBox, WzToolbarButton } from "./toolbar";

const cls = (el: Element) => el.className.toString().split(/\s+/);

describe("WzListToolbar", () => {
  it("is the grey strip above every Workiz grid: #f7f7f7, a #ddd top rule, 71px", () => {
    render(<WzListToolbar data-testid="strip">x</WzListToolbar>);
    expect(cls(screen.getByTestId("strip"))).toEqual(
      expect.arrayContaining(["bg-muted", "border-t", "border-wz-frame", "min-h-[71px]"]),
    );
  });
});

describe("WzSearchBox", () => {
  it("is the 348×40 Search box: grey #9ea6aa edge, 13px ink, blue when focused", () => {
    render(<WzSearchBox value="" onChange={() => {}} />);
    const box = screen.getByRole("textbox", { name: "Search" });
    expect(box).toHaveAttribute("placeholder", "Search");
    expect(cls(box)).toEqual(
      expect.arrayContaining(["h-10", "border-wz-outline", "text-[13px]", "focus:border-wz-link"]),
    );
  });

  it("types through and clears with the round ×, which only shows with text", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<WzSearchBox value="" onChange={onChange} />);
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "Dust" } });
    expect(onChange).toHaveBeenLastCalledWith("Dust");
    rerender(<WzSearchBox value="Dust" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(onChange).toHaveBeenLastCalledWith("");
  });
});

describe("WzPageSizeSelect", () => {
  it("is Workiz's native page-size box and hands back a number", () => {
    const onChange = vi.fn();
    render(<WzPageSizeSelect value={50} sizes={[10, 50, 100]} onChange={onChange} />);
    const select = screen.getByRole("combobox", { name: "Rows per page" });
    fireEvent.change(select, { target: { value: "100" } });
    expect(onChange).toHaveBeenCalledWith(100);
    expect(cls(select.parentElement!)).toEqual(expect.arrayContaining(["h-[34px]", "w-[75px]", "rounded-chip", "bg-muted"]));
  });
});

describe("WzToolbarButton", () => {
  it("is the square Export / Fields button: 34px, 1px #ccc, 2px corners, see-through", () => {
    render(
      <WzToolbarButton>
        <Table2 />
        Fields
      </WzToolbarButton>,
    );
    const b = screen.getByRole("button", { name: "Fields" });
    expect(b).toHaveAttribute("type", "button");
    expect(cls(b)).toEqual(expect.arrayContaining(["h-[34px]", "border-input", "rounded-chip", "bg-transparent"]));
    expect(cls(b)).not.toContain("bg-background");
  });
});
