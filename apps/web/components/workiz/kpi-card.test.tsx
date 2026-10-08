import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WzKpiCard, WzKpiCardSkeleton } from "./kpi-card";

const cls = (el: Element) => el.className.toString().split(/\s+/);

describe("WzKpiCard — the KPI card over Workiz's lists", () => {
  it("prints the number over its caption, both right-aligned", () => {
    render(<WzKpiCard value="370,358" caption="Clients" />);
    const card = screen.getByRole("group", { name: "Clients" });
    expect(card).toHaveTextContent("370,358Clients");
    expect(cls(screen.getByText("370,358"))).toEqual(expect.arrayContaining(["text-[19.6px]", "font-medium", "text-wz-tab-bar"]));
    expect(cls(screen.getByText("Clients"))).toEqual(expect.arrayContaining(["text-sm", "text-wz-caption"]));
    expect(cls(card)).toEqual(expect.arrayContaining(["text-right", "border-l-[3px]"]));
  });

  it("takes Workiz's rule colours: ink, orange (Due), red (Past due)", () => {
    const { rerender } = render(<WzKpiCard value="1" caption="a" />);
    expect(cls(screen.getByRole("group"))).toContain("border-l-foreground");
    rerender(<WzKpiCard value="1" caption="a" tone="orange" />);
    expect(cls(screen.getByRole("group"))).toContain("border-l-[#ffae00]");
    rerender(<WzKpiCard value="1" caption="a" tone="red" />);
    expect(cls(screen.getByRole("group"))).toContain("border-l-[#dd380d]");
  });

  it("is named by an explicit label when the caption carries numbers", () => {
    render(<WzKpiCard value="$5" caption="Due from 3 clients" label="Due" />);
    expect(screen.getByRole("group", { name: "Due" })).toBeInTheDocument();
  });

  it("has a skeleton of the same box", () => {
    render(<WzKpiCardSkeleton />);
    expect(cls(screen.getByTestId("wz-kpi-card-skeleton"))).toEqual(expect.arrayContaining(["h-[81px]", "border-l-[3px]"]));
  });
});
