import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataScope } from "@bitcrm/types";
import type { DataScopeRules } from "@bitcrm/types";
import { ONLY_ASSIGNED_RESOURCES } from "../only-assigned";
import { OnlyAssignedRow, ONLY_ASSIGNED_ROW_WORDS } from "./only-assigned-row";

const { ALL, DEPARTMENT, ASSIGNED_ONLY } = DataScope;
const every = (scope: DataScope, extra: DataScopeRules = {}): DataScopeRules => ({
  ...Object.fromEntries(ONLY_ASSIGNED_RESOURCES.map((r) => [r, scope])),
  ...extra,
});

const NAME = "Sees only jobs assigned to them";

/**
 * The switch that took the Advanced tab's place, in Workiz's row on the
 * Actions tab (`WzSwitchRow`: the title, the sentence, the 40×20 switch).
 */
describe("OnlyAssignedRow", () => {
  it("is a Workiz switch row: the title, the sentence, one switch", () => {
    render(<OnlyAssignedRow dataScope={every(ALL)} onChange={() => {}} />);
    const row = screen.getByRole("heading", { level: 5, name: NAME }).closest("[data-slot=wz-switch-row]") as HTMLElement;
    expect(
      within(row).getByText(
        "Jobs, their invoices, estimates, payments, commissions and messages: only the ones this person is assigned to.",
      ),
    ).toBeInTheDocument();
    expect(within(row).getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: NAME })).not.toBeChecked();
    expect(ONLY_ASSIGNED_ROW_WORDS).toContain(NAME);
  });

  it("is on when every job-bound resource is assigned-only", () => {
    render(<OnlyAssignedRow dataScope={every(ASSIGNED_ONLY)} onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: NAME })).toBeChecked();
  });

  it("turns them all assigned-only, and back to what the saved scope had, leaving the rest", async () => {
    const onChange = vi.fn();
    const saved = every(ALL, { deals: DEPARTMENT, containers: ASSIGNED_ONLY });
    const { rerender } = render(<OnlyAssignedRow dataScope={saved} fallback={saved} onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch", { name: NAME }));
    expect(onChange).toHaveBeenLastCalledWith(every(ASSIGNED_ONLY, { containers: ASSIGNED_ONLY }));

    rerender(<OnlyAssignedRow dataScope={onChange.mock.lastCall![0]} fallback={saved} onChange={onChange} />);
    await userEvent.click(screen.getByRole("switch", { name: NAME }));
    expect(onChange).toHaveBeenLastCalledWith(saved);
  });

  it("says which are limited when only some are", () => {
    const { rerender } = render(<OnlyAssignedRow dataScope={every(ALL, { deals: ASSIGNED_ONLY })} onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: NAME })).not.toBeChecked();
    expect(screen.getByText("Partly on now — only for Jobs.")).toBeInTheDocument();
    rerender(
      <OnlyAssignedRow
        dataScope={every(ALL, { deals: ASSIGNED_ONLY, invoices: ASSIGNED_ONLY, messages: ASSIGNED_ONLY })}
        onChange={() => {}}
      />,
    );
    expect(screen.getByText("Partly on now — only for Jobs, Invoices and Messages.")).toBeInTheDocument();
  });

  it("marks the switch changed when it differs from the baseline, like every other row", () => {
    const { container, rerender } = render(
      <OnlyAssignedRow dataScope={every(ASSIGNED_ONLY)} baseline={every(ALL)} onChange={() => {}} />,
    );
    expect(container.querySelector('[title="Changed"]')).not.toBeNull();
    // Department and all read the same here: not a change.
    rerender(<OnlyAssignedRow dataScope={every(ALL)} baseline={every(DEPARTMENT)} onChange={() => {}} />);
    expect(container.querySelector('[title="Changed"]')).toBeNull();
  });

  it("is greyed for a reader", () => {
    render(<OnlyAssignedRow dataScope={every(ALL)} readOnly onChange={() => {}} />);
    expect(screen.getByRole("switch", { name: NAME })).toBeDisabled();
  });
});
