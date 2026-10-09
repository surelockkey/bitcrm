import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzLegacyPillButton, WzLegacySummary } from "./legacy-report-parts";

describe("WzLegacyPillButton", () => {
  it("is a button; `pressed` keeps it in its hover yellow and says so", async () => {
    const onClick = vi.fn();
    render(
      <>
        <WzLegacyPillButton onClick={onClick}>Export</WzLegacyPillButton>
        <WzLegacyPillButton pressed aria-expanded>
          Fields
        </WzLegacyPillButton>
      </>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    expect(onClick).toHaveBeenCalled();
    const fields = screen.getByRole("button", { name: "Fields" });
    expect(fields).toHaveAttribute("aria-expanded", "true");
    expect(fields.className).toContain("bg-wz-primary-hover");
  });
});

describe("WzLegacySummary", () => {
  it("a titled table: the heading, the column names, a row per entry", () => {
    render(
      <WzLegacySummary
        title="Total by type"
        columns={["Type", "Total", "Jobs"]}
        rows={[
          { key: "cash", cells: ["cash", "22282.61", "89"] },
          { key: "credit", cells: ["credit", "48831.56", "96"] },
        ]}
      />,
    );
    expect(screen.getByRole("heading", { name: "Total by type" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Total by type" });
    const rows = within(table).getAllByRole("row");
    expect(rows.map((r) => r.textContent)).toEqual(["TypeTotalJobs", "cash22282.6189", "credit48831.5696"]);
  });

  it("no entries: the names only, as Workiz leaves an empty period", () => {
    render(<WzLegacySummary title="Total Profits" columns={["Profit For", "Amount"]} rows={[]} />);
    expect(within(screen.getByRole("table", { name: "Total Profits" })).getAllByRole("row")).toHaveLength(1);
  });
});
