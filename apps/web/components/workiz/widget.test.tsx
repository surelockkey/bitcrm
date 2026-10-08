import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WzChartLegend, WzRangeSelect, WzWidget, WzWidgetStat } from "./widget";

/** Workiz Home's widget frame (pg_dashboard_wz_home, `styles__frame`). */
describe("WzWidget", () => {
  it("is a 350px card named by its title", () => {
    render(<WzWidget title="Top Sources">body</WzWidget>);
    const card = screen.getByRole("region", { name: "Top Sources" });
    expect(card.className).toContain("h-[350px]");
    expect(screen.getByRole("heading", { name: "Top Sources" })).toBeInTheDocument();
  });

  it("says when its numbers were computed only when told — Workiz shows it on some widgets", () => {
    const { rerender } = render(<WzWidget title="Jobs">x</WzWidget>);
    expect(screen.queryByText(/updated/)).toBeNull();
    rerender(
      <WzWidget title="Jobs" updatedAt="3:06 PM">
        x
      </WzWidget>,
    );
    expect(screen.getByText("updated 3:06 PM")).toBeInTheDocument();
  });

  it("carries the ? only where there is help to give", () => {
    const { rerender } = render(<WzWidget title="Jobs">x</WzWidget>);
    expect(screen.queryByRole("button", { name: "About Jobs" })).toBeNull();
    rerender(
      <WzWidget title="Jobs" help="Current status of jobs">
        x
      </WzWidget>,
    );
    expect(screen.getByRole("button", { name: "About Jobs" })).toBeInTheDocument();
  });

  it("refreshes on the round arrows, and holds still while it is already refreshing", async () => {
    const refresh = vi.fn();
    const { rerender } = render(
      <WzWidget title="Sales" onRefresh={refresh}>
        x
      </WzWidget>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Refresh Sales" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    rerender(
      <WzWidget title="Sales" onRefresh={refresh} refreshing>
        x
      </WzWidget>,
    );
    expect(screen.getByRole("button", { name: "Refresh Sales" })).toBeDisabled();
  });

  it("opens Workiz's kebab menu with the items it is given", async () => {
    const manage = vi.fn();
    const remove = vi.fn();
    render(
      <WzWidget
        title="Sales"
        menu={[
          { key: "manage", label: "Manage Permissions", onSelect: manage },
          { key: "remove", label: "Remove", onSelect: remove },
        ]}
      >
        x
      </WzWidget>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Sales options" }));
    expect(screen.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Manage Permissions", "Remove"]);
    await userEvent.click(screen.getByRole("menuitem", { name: "Remove" }));
    expect(remove).toHaveBeenCalled();
    expect(manage).not.toHaveBeenCalled();
  });

  it("puts View All at the foot, underlined unless told otherwise", () => {
    const { rerender } = render(
      <WzWidget title="Jobs" viewAll={{ href: "/deals" }}>
        x
      </WzWidget>,
    );
    const link = screen.getByRole("link", { name: "View All" });
    expect(link.getAttribute("href")).toBe("/deals");
    expect(link.className).toContain("underline");
    rerender(
      <WzWidget title="Sales" viewAll={{ href: "/reports", underline: false }}>
        x
      </WzWidget>,
    );
    expect(screen.getByRole("link", { name: "View All" }).className).not.toMatch(/(^|\s)underline(\s|$)/);
  });
});

/** Workiz's `simpleSelect`: "Last 14 Days ⌄", right-aligned menu. */
describe("WzRangeSelect", () => {
  const options = [
    { value: "this_week", label: "This week (Mon-Today)" },
    { value: "last_14_days", label: "Last 14 days" },
  ];

  it("shows the chosen range and hands back the one picked", async () => {
    const change = vi.fn();
    render(<WzRangeSelect label="Range" value="last_14_days" options={options} onChange={change} />);
    const trigger = screen.getByRole("button", { name: "Range: Last 14 days" });
    expect(trigger).toHaveTextContent("Last 14 days");
    await userEvent.click(trigger);
    expect(screen.getAllByRole("menuitemradio").map((o) => o.textContent)).toEqual([
      "This week (Mon-Today)",
      "Last 14 days",
    ]);
    expect(screen.getByRole("menuitemradio", { name: "Last 14 days" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "This week (Mon-Today)" }));
    expect(change).toHaveBeenCalledWith("this_week");
  });
});

describe("WzWidgetStat", () => {
  it("is a label and a figure, with an optional grey line under the label and a coloured rule", () => {
    render(<WzWidgetStat label="Pending" value="299" sub="Worth $9,275.37" rule="border-wz-stat-slate" />);
    const row = screen.getByText("Pending").closest("[data-slot=wz-widget-stat]")!;
    expect(row.className).toContain("border-wz-stat-slate");
    expect(row).toHaveTextContent("Worth $9,275.37");
    expect(row).toHaveTextContent("299");
  });

  it("draws no rule when it has none", () => {
    render(<WzWidgetStat label="Unsent" value="51" />);
    expect(screen.getByText("Unsent").closest("[data-slot=wz-widget-stat]")!.className).not.toContain("border-l-2");
  });
});

describe("WzChartLegend", () => {
  it("names each series beside its dot, with its figure when it has one", () => {
    render(
      <WzChartLegend
        items={[
          { label: "Net", color: "var(--wz-chart-done)", value: "$149,480.00" },
          { label: "Total", color: "var(--wz-chart-track)" },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual(["Net $149,480.00", "Total"]);
  });
});
