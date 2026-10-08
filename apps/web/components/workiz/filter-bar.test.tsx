import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzAddFilter, WzFilterField, WzFilterOptions } from "./filter-bar";

/**
 * Workiz's "+ Add filter" row (callspage_wz_05_*): a menu of filter kinds
 * with its own search box; each picked kind becomes a chip "Direction is
 * (any)" whose panel lists the options with a search box and "Apply".
 */
describe("WzAddFilter", () => {
  const kinds = [
    { id: "direction", label: "Direction" },
    { id: "status", label: "Status" },
    { id: "tag", label: "Tags" },
  ];

  it("lists the kinds, narrowed by Search filters, and hands back the one picked", async () => {
    const onAdd = vi.fn();
    render(<WzAddFilter kinds={kinds} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "+ Add filter" }));
    const menu = screen.getByRole("menu", { name: "Add filter" });
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Direction", "Status", "Tags"]);

    await userEvent.type(within(menu).getByRole("textbox", { name: "Search filters" }), "ta");
    expect(within(menu).getAllByRole("menuitem").map((b) => b.textContent)).toEqual(["Status", "Tags"]);

    await userEvent.click(within(menu).getByRole("menuitem", { name: "Tags" }));
    expect(onAdd).toHaveBeenCalledWith("tag");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("is not drawn when there is nothing left to add", () => {
    render(<WzAddFilter kinds={[]} onAdd={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "+ Add filter" })).not.toBeInTheDocument();
  });
});

describe("WzFilterField", () => {
  it("reads 'Direction is (any)', opens its panel and can be removed", async () => {
    const onOpenChange = vi.fn();
    const onRemove = vi.fn();
    render(
      <WzFilterField name="Direction" value="(any)" open={false} onOpenChange={onOpenChange} onRemove={onRemove}>
        <div>panel</div>
      </WzFilterField>,
    );
    const chip = screen.getByRole("button", { name: "Direction is (any)" });
    await userEvent.click(chip);
    expect(onOpenChange).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "Remove Direction filter" }));
    expect(onRemove).toHaveBeenCalled();
  });

  it("shows its panel while open", () => {
    render(
      <WzFilterField name="Status" value="(any)" open onOpenChange={vi.fn()} onRemove={vi.fn()}>
        <div>the panel</div>
      </WzFilterField>,
    );
    expect(screen.getByText("the panel")).toBeInTheDocument();
  });
});

describe("WzFilterOptions", () => {
  const options = [
    { value: "outbound", label: "Outgoing calls" },
    { value: "inbound", label: "Incoming calls" },
  ];

  it("ticks several with Select All, and applies the draft only on Apply", async () => {
    const onApply = vi.fn();
    render(<WzFilterOptions searchLabel="Search direction" options={options} selected={[]} multi onApply={onApply} />);
    await userEvent.click(screen.getByRole("checkbox", { name: "Incoming calls" }));
    expect(onApply).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenLastCalledWith(["inbound"]);

    await userEvent.click(screen.getByRole("checkbox", { name: "Select All" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenLastCalledWith(["outbound", "inbound"]);
  });

  it("takes one value where the filter allows one, and has no Select All", async () => {
    const onApply = vi.fn();
    render(<WzFilterOptions searchLabel="Search tags" options={options} selected={["outbound"]} onApply={onApply} />);
    expect(screen.queryByRole("checkbox", { name: "Select All" })).not.toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Outgoing calls" })).toBeChecked();
    await userEvent.click(screen.getByRole("radio", { name: "Incoming calls" }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenCalledWith(["inbound"]);
  });

  it("narrows the options by its search box", async () => {
    render(<WzFilterOptions searchLabel="Search direction" options={options} selected={[]} multi onApply={vi.fn()} />);
    await userEvent.type(screen.getByRole("textbox", { name: "Search direction" }), "inc");
    expect(screen.queryByRole("checkbox", { name: "Outgoing calls" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Incoming calls" })).toBeInTheDocument();
  });
});
