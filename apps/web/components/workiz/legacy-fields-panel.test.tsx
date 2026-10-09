import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzLegacyFieldsPanel } from "./legacy-fields-panel";

const FIELDS = [
  { id: "dealNumber", label: "Job Id", on: true },
  { id: "createdAt", label: "Created", on: false },
  { id: "companyParts", label: "Company Parts", on: true },
];

describe("WzLegacyFieldsPanel", () => {
  it("lists every field as a switch that says whether it is shown", () => {
    render(<WzLegacyFieldsPanel fields={FIELDS} onToggle={() => {}} onClose={() => {}} />);
    const panel = screen.getByRole("group", { name: "Fields" });
    const switches = within(panel).getAllByRole("switch");
    expect(switches.map((s) => s.getAttribute("aria-label"))).toEqual(["Job Id", "Created", "Company Parts"]);
    expect(switches.map((s) => s.getAttribute("aria-checked"))).toEqual(["true", "false", "true"]);
    // Workiz's label reads "Created:".
    expect(within(panel).getByText("Created:")).toBeInTheDocument();
  });

  it("a click flips that field only", async () => {
    const onToggle = vi.fn();
    render(<WzLegacyFieldsPanel fields={FIELDS} onToggle={onToggle} onClose={() => {}} />);
    await userEvent.click(screen.getByRole("switch", { name: "Created" }));
    expect(onToggle).toHaveBeenCalledWith("createdAt");
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("✕ closes it", async () => {
    const onClose = vi.fn();
    render(<WzLegacyFieldsPanel fields={FIELDS} onToggle={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: "Hide fields" }));
    expect(onClose).toHaveBeenCalled();
  });
});
