import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { InventoryStatus } from "@bitcrm/types";
import type { StockLocation } from "../lib";
import { LocationPicker } from "./location-picker";

const van = (id: string, name: string): StockLocation =>
  ({ type: "container", id, name, status: InventoryStatus.ACTIVE }) as StockLocation;

const VANS = [van("v1", "(2) JESSE GLOVER"), van("v2", "(2) DONIEL COBB"), van("v3", "(2) JOSEPH HARRAR")];

function Harness({ onChange = vi.fn() }: { onChange?: (l: StockLocation) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState<StockLocation | null>(null);
  return (
    // The popups put the picker inside a body that scrolls: a list drawn in
    // there is clipped by the body's edge and the popup footer.
    <div data-testid="scroll-body" style={{ overflowY: "auto", maxHeight: 200 }}>
      <span id="lbl">Container</span>
      <LocationPicker
        labelId="lbl"
        groups={{ warehouses: [], containers: VANS }}
        value={value}
        onChange={(l) => {
          setValue(l);
          onChange(l);
          setOpen(false);
        }}
        open={open}
        onOpenChange={setOpen}
        placeholder="Pick a container"
      />
    </div>
  );
}

describe("LocationPicker", () => {
  it("draws the open list outside the scrolling body, so nothing clips it", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox", { name: "Container" }));

    const option = await screen.findByText("(2) JOSEPH HARRAR");
    expect(screen.getByTestId("scroll-body")).not.toContainElement(option);
  });

  it("shows every van, not just the first", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox", { name: "Container" }));

    for (const v of VANS) expect(await screen.findByText(v.name)).toBeInTheDocument();
  });

  it("picks a van and closes the list", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.click(screen.getByRole("combobox", { name: "Container" }));
    await userEvent.click(await screen.findByText("(2) DONIEL COBB"));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: "v2" }));
    expect(screen.queryByText("(2) JESSE GLOVER")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Container" })).toHaveTextContent("(2) DONIEL COBB");
  });

  it("filters by what is typed", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("combobox", { name: "Container" }));
    await userEvent.type(await screen.findByPlaceholderText("Search locations"), "harrar");

    expect(screen.getByText("(2) JOSEPH HARRAR")).toBeInTheDocument();
    expect(screen.queryByText("(2) DONIEL COBB")).not.toBeInTheDocument();
  });
});
