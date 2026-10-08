import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobsReportColumnId } from "@bitcrm/types";
import { JobsReportFields } from "./jobs-report-fields";

/*
 * Workiz's "Visible fields" panel on the Jobs report (rep_jobs_wz_10_fields_open,
 * _10_fields_scroll1): USED FIELDS in the report's fixed order, then UNSELECTED
 * FIELDS; a tick moves a field between them; nothing is dragged.
 */
const COLUMNS: JobsReportColumnId[] = ["jobNumber", "client", "phone", "total"];

function open(over: Partial<Parameters<typeof JobsReportFields>[0]> = {}) {
  const onApply = vi.fn();
  render(<JobsReportFields open onOpenChange={() => {}} columns={COLUMNS} money canSave onApply={onApply} {...over} />);
  return onApply;
}

const section = (name: string) => screen.getByRole("region", { name });
const names = (name: string) =>
  within(section(name))
    .getAllByRole("checkbox")
    .map((c) => c.getAttribute("aria-label"));

describe("JobsReportFields", () => {
  it("lists the used fields first, the rest under Unselected fields, in the report's order", () => {
    open();
    expect(screen.getByRole("dialog", { name: "Visible fields" })).toBeInTheDocument();
    expect(names("Used fields")).toEqual(["Job #", "Client", "Phone", "Total"]);
    expect(names("Unselected fields")).toEqual([
      "Job name", "Tags", "Type", "Job Created", "Scheduled", "End", "Email", "Status", "Tech", "Created by",
      "Address", "City", "State", "Zip code", "Metro Area", "Source", "External Company", "Lead Created Date", "Job origin",
    ]);
  });

  it("moves a ticked field up into its place, and saves the account's choice", async () => {
    const onApply = open();
    await userEvent.click(within(section("Unselected fields")).getByRole("checkbox", { name: "Email" }));
    expect(names("Used fields")).toEqual(["Job #", "Client", "Phone", "Email", "Total"]);
    await userEvent.click(within(section("Used fields")).getByRole("checkbox", { name: "Phone" }));
    await userEvent.click(screen.getByRole("button", { name: "Save fields" }));
    expect(onApply).toHaveBeenLastCalledWith(["jobNumber", "client", "email", "total"], true);
  });

  it("finds a field by its name", async () => {
    open();
    await userEvent.type(screen.getByPlaceholderText("Type field name here"), "zip");
    expect(screen.getAllByRole("checkbox").map((c) => c.getAttribute("aria-label"))).toEqual(["Zip code"]);
  });

  it("keeps at least one field", async () => {
    open({ columns: ["jobNumber"] });
    await userEvent.click(screen.getByRole("checkbox", { name: "Job #" }));
    expect(screen.getByRole("button", { name: "Save fields" })).toBeDisabled();
  });

  it("offers no Total without financials.view, and applies to this screen only without reports.edit", async () => {
    const onApply = open({ money: false, canSave: false });
    expect(screen.queryByRole("checkbox", { name: "Total" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onApply).toHaveBeenLastCalledWith(["jobNumber", "client", "phone", "total"], false);
  });
});
