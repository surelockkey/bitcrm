import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Wrench } from "lucide-react";

import { WzSettingsCatalog } from "./settings-catalog";
import type { WzGridColumn } from "./local-grid";

interface Row {
  id: string;
  name: string;
  active: boolean;
}

const ROWS: Row[] = [
  { id: "1", name: "Lockout", active: true },
  { id: "2", name: "Rekey", active: false },
  { id: "3", name: "Safe", active: true },
];
const COLUMNS: WzGridColumn<Row>[] = [
  { id: "name", label: "Type Name", render: (r) => r.name, sortValue: (r) => r.name, searchText: (r) => r.name },
];

function renderCatalog(over: Partial<React.ComponentProps<typeof WzSettingsCatalog<Row>>> = {}) {
  return render(
    <WzSettingsCatalog<Row>
      icon={<Wrench />}
      title="Job Types"
      description="Add your job types and assign to jobs."
      label="Job types"
      ready
      rows={ROWS}
      rowKey={(r) => r.id}
      columns={COLUMNS}
      {...over}
    />,
  );
}

describe("WzSettingsCatalog — a Workiz settings catalog page", () => {
  it("draws the band, then the grid of rows", () => {
    renderCatalog();
    expect(screen.getByRole("heading", { level: 2, name: "Job Types" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Job types" });
    expect(within(table).getByText("Lockout")).toBeInTheDocument();
    expect(within(table).getByText("Rekey")).toBeInTheDocument();
  });

  it("is one skeleton under the band until ready — no button, no grid", () => {
    renderCatalog({ ready: false, onAdd: () => {} });
    expect(screen.getByRole("heading", { level: 2, name: "Job Types" })).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add New" })).toBeNull();
    expect(document.querySelectorAll("[data-slot=skeleton]").length).toBe(1);
  });

  it("filters on Show: Active first, then Disabled or All", async () => {
    renderCatalog({ isActive: (r) => r.active });
    const table = () => screen.getByRole("table", { name: "Job types" });
    expect(within(table()).queryByText("Rekey")).toBeNull();
    expect(within(table()).getByText("Lockout")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("combobox", { name: "Show" }));
    await userEvent.click(await screen.findByRole("option", { name: "Disabled" }));
    expect(within(table()).getByText("Rekey")).toBeInTheDocument();
    expect(within(table()).queryByText("Lockout")).toBeNull();
  });

  it("offers Add New only when the caller can add, and calls it", async () => {
    const onAdd = vi.fn();
    const { rerender } = renderCatalog();
    expect(screen.queryByRole("button", { name: "Add New" })).toBeNull();
    rerender(
      <WzSettingsCatalog<Row>
        icon={<Wrench />}
        title="Job Types"
        label="Job types"
        ready
        rows={ROWS}
        rowKey={(r) => r.id}
        columns={COLUMNS}
        onAdd={onAdd}
        addLabel="Add Service area"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Add Service area" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("opens a record from its row, and from its name for the keyboard", async () => {
    const onOpen = vi.fn();
    renderCatalog({ onOpen, openLabel: (r) => `Edit ${r.name}` });
    await userEvent.click(screen.getByText("Safe"));
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[2]);
    const edit = screen.getByRole("button", { name: "Edit Lockout" });
    edit.focus();
    await userEvent.keyboard("{Enter}");
    expect(onOpen).toHaveBeenLastCalledWith(ROWS[0]);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it("leaves the names as words when nothing opens", () => {
    renderCatalog();
    expect(screen.queryByRole("button", { name: /Lockout/ })).toBeNull();
  });
});
