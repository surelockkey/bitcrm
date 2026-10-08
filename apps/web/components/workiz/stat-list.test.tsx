import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WzStatList } from "./stat-list";

describe("WzStatList", () => {
  const items = [
    { key: "done", value: "296", caption: ["Jobs", "Done"] as const },
    { key: "gross", value: "133,524.60", caption: ["Total", "Sales"] as const },
  ];

  it("lists each figure with its two-line caption, named by both lines", () => {
    render(<WzStatList aria-label="Totals" items={items} />);
    const list = screen.getByRole("list", { name: "Totals" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("296");
    expect(within(rows[0]).getByText("Jobs Done")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Total Sales")).toBeInTheDocument();
  });

  it("draws Workiz's ul.stats: 48px light figures, 72px rows ruled at 25% black", () => {
    render(<WzStatList aria-label="Totals" items={items} />);
    const figure = screen.getByText("296");
    expect(figure.className).toContain("text-[48px]");
    expect(figure.className).toContain("font-light");
    const second = screen.getAllByRole("listitem")[1];
    expect(second.className).toContain("border-black/25");
  });
});
