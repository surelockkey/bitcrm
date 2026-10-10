import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PermissionMatrixEditor, preset } from "./permission-matrix";

const schema = {
  deals: ["view", "create", "edit", "delete", "move_status"],
  transfers: ["view", "create", "edit", "delete"],
  reports: ["view", "create", "view_profit"],
};

/**
 * Workiz's permission list (pg_admin_users_wz_10_role_dispatch): one green
 * switch per row, the title and its sentence beside it.
 */
describe("PermissionMatrixEditor", () => {
  it("draws one Workiz switch per row, named, with the row's title and sentence", () => {
    render(<PermissionMatrixEditor schema={schema} permissions={{ deals: { view: true } }} onChange={() => {}} />);
    const row = screen.getByRole("heading", { level: 5, name: "Add Jobs" }).closest("[data-slot=wz-switch-row]") as HTMLElement;
    expect(within(row).getByText("Schedule new jobs")).toBeInTheDocument();
    expect(within(row).getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: "Jobs View" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Jobs Create" })).not.toBeChecked();
  });

  it("does not offer switches nothing reads", () => {
    render(<PermissionMatrixEditor schema={schema} permissions={{}} onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: "Transfers Create" })).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Transfers Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "Transfers Delete" })).not.toBeInTheDocument();
  });

  it("flips a switch", async () => {
    const onChange = vi.fn();
    render(<PermissionMatrixEditor schema={schema} permissions={{ deals: { view: true } }} onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch", { name: "Jobs Change status" }));
    expect(onChange).toHaveBeenCalledWith({ deals: { view: true, move_status: true } });
  });

  it("Reports: a row per report switch", () => {
    render(<PermissionMatrixEditor schema={schema} section="reports" permissions={{}} onChange={() => {}} />);
    expect(screen.getAllByRole("heading", { level: 5 }).map((h) => h.textContent)).toEqual([
      "Reports",
      "Statistics Report: View Profit",
    ]);
  });

  it("Search keeps the rows it finds, and draws nothing for no match", () => {
    const { rerender } = render(<PermissionMatrixEditor schema={schema} query="status" permissions={{}} onChange={() => {}} />);
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual(["Jobs Change status"]);
    rerender(<PermissionMatrixEditor schema={schema} query="zzzq" permissions={{}} onChange={() => {}} />);
    expect(screen.queryAllByRole("switch")).toEqual([]);
  });

  /** "Sees only jobs assigned to them" — ours, at the top of the jobs block, found by Search like any row. */
  const lead = {
    resource: "deals",
    words: ["Sees only jobs assigned to them", "Jobs, their invoices"],
    node: <h5 key="lead">Sees only jobs assigned to them</h5>,
  };

  it("draws a lead row first in its resource's block, before the resource's own rows", () => {
    render(<PermissionMatrixEditor schema={schema} permissions={{}} onChange={() => {}} lead={lead} />);
    const titles = screen.getAllByRole("heading", { level: 5 }).map((h) => h.textContent);
    expect(titles.slice(0, 2)).toEqual(["Sees only jobs assigned to them", "View Jobs"]);
  });

  it("Search keeps the lead row (and its block) when its words match, and drops it when they do not", () => {
    const { rerender } = render(
      <PermissionMatrixEditor schema={schema} query="assigned" permissions={{}} onChange={() => {}} lead={lead} />,
    );
    expect(screen.getAllByRole("heading", { level: 5 }).map((h) => h.textContent)).toEqual(["Sees only jobs assigned to them"]);
    expect(screen.getByText("Jobs & clients")).toBeInTheDocument();
    rerender(<PermissionMatrixEditor schema={schema} query="status" permissions={{}} onChange={() => {}} lead={lead} />);
    expect(screen.queryByRole("heading", { level: 5, name: "Sees only jobs assigned to them" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("switch").map((s) => s.getAttribute("aria-label"))).toEqual(["Jobs Change status"]);
  });

  it("leaves the lead row off the Reports tab", () => {
    render(<PermissionMatrixEditor schema={schema} section="reports" permissions={{}} onChange={() => {}} lead={lead} />);
    expect(screen.queryByRole("heading", { level: 5, name: "Sees only jobs assigned to them" })).not.toBeInTheDocument();
  });
});

describe("preset", () => {
  it("sets a resource's shown switches and keeps the ones the editor does not offer", () => {
    const before = { transfers: { view: false, create: false, edit: true, delete: true }, deals: { view: true } };
    expect(preset(before, schema, "transfers", "none").transfers).toEqual({ view: false, create: false, edit: true, delete: true });
    expect(preset(before, schema, "transfers", "full").transfers).toEqual({ view: true, create: true, edit: true, delete: true });
    expect(preset(before, schema, "deals", "view").deals).toEqual({
      view: true,
      create: false,
      edit: false,
      delete: false,
      move_status: false,
    });
    expect(preset(before, schema, "deals", "view").transfers).toBe(before.transfers);
  });
});
