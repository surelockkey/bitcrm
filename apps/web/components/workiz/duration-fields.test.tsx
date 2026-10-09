import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzDurationFields } from "./duration-fields";

/**
 * Workiz's Duration boxes on a job type (pg_settings_catalogs_wz_jobtypes_add_open):
 * Days / Hours / Minutes, each a label over a select, "How long does this
 * type of job usually take?" under them; Days 0–31, Hours 0–23, Minutes 0–59
 * (feat_job_rules_wz_jobtype_{days,hours,minutes}_open).
 */
describe("WzDurationFields", () => {
  it("shows the three boxes with the value split into days, hours and minutes", () => {
    render(<WzDurationFields value={3000} onChange={() => {}} />);
    expect(screen.getByRole("combobox", { name: "Days" })).toBeInTheDocument();
    // 3000 minutes = 2 days, 2 hours, 0 minutes.
    expect(screen.getAllByText("2", { selector: "[data-slot=wz-select-value]" })).toHaveLength(2);
    expect(screen.getAllByText("0", { selector: "[data-slot=wz-select-value]" })).toHaveLength(1);
    expect(screen.getByText("How long does this type of job usually take?")).toBeInTheDocument();
  });

  it("offers Workiz's ranges", async () => {
    const u = userEvent.setup();
    render(<WzDurationFields value={0} onChange={() => {}} />);
    await u.click(screen.getByRole("combobox", { name: "Minutes" }));
    const list = screen.getByRole("listbox");
    expect(within(list).getAllByRole("option")).toHaveLength(60);
    await u.keyboard("{Escape}");
    await u.click(screen.getByRole("combobox", { name: "Hours" }));
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(24);
    await u.keyboard("{Escape}");
    await u.click(screen.getByRole("combobox", { name: "Days" }));
    expect(within(screen.getByRole("listbox")).getAllByRole("option")).toHaveLength(32);
  });

  it("reports the whole length in minutes when a box changes", async () => {
    const u = userEvent.setup();
    const onChange = vi.fn();
    render(<WzDurationFields value={60} onChange={onChange} />);
    await u.click(screen.getByRole("combobox", { name: "Hours" }));
    await u.click(within(screen.getByRole("listbox")).getByRole("option", { name: "4" }));
    expect(onChange).toHaveBeenLastCalledWith(240);
    await u.click(screen.getByRole("combobox", { name: "Minutes" }));
    await u.click(within(screen.getByRole("listbox")).getByRole("option", { name: "30" }));
    expect(onChange).toHaveBeenLastCalledWith(90);
  });
});
