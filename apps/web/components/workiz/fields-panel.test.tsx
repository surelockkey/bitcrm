import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzFieldsPanel, fieldsPanelLists, moveField, toggleField } from "./fields-panel";

const OPTIONS = [
  { id: "name", label: "Name" },
  { id: "address", label: "Address" },
  { id: "phone", label: "Phone" },
  { id: "created", label: "Created" },
  { id: "company", label: "Company" },
  { id: "source", label: "Ad Source" },
];

describe("the panel's rules", () => {
  it("USED in the draft's order, UNSELECTED in the registry's, both narrowed by the search", () => {
    expect(fieldsPanelLists(OPTIONS, ["phone", "name"], "")).toEqual({
      used: [OPTIONS[2], OPTIONS[0]],
      unselected: [OPTIONS[1], OPTIONS[3], OPTIONS[4], OPTIONS[5]],
    });
    expect(fieldsPanelLists(OPTIONS, ["phone", "name"], "  AD ")).toEqual({
      used: [],
      unselected: [OPTIONS[1], OPTIONS[5]],
    });
  });

  it("ticking adds at the end, unticking takes out", () => {
    expect(toggleField(["name"], "phone")).toEqual(["name", "phone"]);
    expect(toggleField(["name", "phone"], "name")).toEqual(["phone"]);
  });

  it("a drag puts the field in the other's slot", () => {
    expect(moveField(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moveField(["a", "b", "c"], "a", "x")).toEqual(["a", "b", "c"]);
  });
});

describe("WzFieldsPanel — Workiz's Visible fields", () => {
  const setup = (used = ["name", "address", "phone", "created"]) => {
    const onSave = vi.fn();
    render(<WzFieldsPanel options={OPTIONS} used={used} onSave={onSave} />);
    return { onSave };
  };

  it("opens from the strip's Fields button with USED and UNSELECTED fields", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Fields" }));
    const panel = screen.getByRole("dialog", { name: "Visible fields" });
    const used = within(panel).getByRole("region", { name: "Used fields" });
    const unselected = within(panel).getByRole("region", { name: "Unselected fields" });
    expect(within(used).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual([
      "Name",
      "Address",
      "Phone",
      "Created",
    ]);
    expect(within(used).getAllByRole("checkbox").every((c) => c.getAttribute("aria-checked") === "true")).toBe(true);
    expect(within(unselected).getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual([
      "Company",
      "Ad Source",
    ]);
  });

  it("saves the draft on Save fields, and only then", async () => {
    const { onSave } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Fields" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Company" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Address" }));
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Save fields" }));
    expect(onSave).toHaveBeenCalledWith(["name", "phone", "created", "company"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel drops the draft", async () => {
    const { onSave } = setup();
    await userEvent.click(screen.getByRole("button", { name: "Fields" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Company" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Fields" }));
    expect(screen.getByRole("checkbox", { name: "Company" })).toHaveAttribute("aria-checked", "false");
  });

  it("Search fields narrows both lists", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: "Fields" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search fields" }), "pho");
    expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Phone"]);
  });

  it("will not save an empty grid", async () => {
    setup(["name"]);
    await userEvent.click(screen.getByRole("button", { name: "Fields" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Name" }));
    expect(screen.getByRole("button", { name: "Save fields" })).toBeDisabled();
  });
});
