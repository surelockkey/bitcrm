import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

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

  it("takes Aging's two light rules too (lightYellowCard, lightRedCard)", () => {
    const { rerender } = render(<WzKpiCard value="1" caption="a" tone="lightYellow" />);
    expect(cls(screen.getByRole("group"))).toContain("border-l-[#ffd57b]");
    rerender(<WzKpiCard value="1" caption="a" tone="lightRed" />);
    expect(cls(screen.getByRole("group"))).toContain("border-l-[#ff7753]");
    render(<WzKpiCardSkeleton tone="lightRed" />);
    expect(cls(screen.getByTestId("wz-kpi-card-skeleton"))).toContain("border-l-[#ff7753]");
  });
});

describe("WzKpiCard with onSelect — a card that picks the rows (Aging invoices)", () => {
  it("is a toggle button named by its label, pressed when chosen", async () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <WzKpiCard value="$24,508.45" caption="under 30 days (34)" tone="lightYellow" label="$24,508.45 under 30 days (34)" onSelect={onSelect} />,
    );
    const card = screen.getByRole("button", { name: "$24,508.45 under 30 days (34)" });
    expect(card).toHaveAttribute("type", "button");
    expect(card).toHaveAttribute("aria-pressed", "false");
    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
    rerender(
      <WzKpiCard value="$24,508.45" caption="under 30 days (34)" tone="lightYellow" label="$24,508.45 under 30 days (34)" onSelect={onSelect} selected />,
    );
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });

  it("draws Workiz's chosen grey and the hover drop (rep_aging_wz_01_default, _02_card_hover)", () => {
    const { rerender } = render(<WzKpiCard value="1" caption="a" onSelect={() => {}} />);
    const idle = cls(screen.getByRole("button"));
    expect(idle).toContain("hover:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4)]");
    expect(idle).toContain("bg-background");
    expect(idle).not.toContain("bg-[#f0f0f0]");
    rerender(<WzKpiCard value="1" caption="a" onSelect={() => {}} selected />);
    expect(cls(screen.getByRole("button"))).toContain("bg-[#f0f0f0]");
  });

  it("stays a plain figure without onSelect", () => {
    render(<WzKpiCard value="1" caption="a" />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(cls(screen.getByRole("group"))).not.toContain("hover:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4)]");
  });
});

describe("WzKpiCard — the Estimates page's status cards (pg_estimates_wz_06_card_won)", () => {
  it("wraps a long caption onto a second line and grows, instead of cutting it", () => {
    render(<WzKpiCard value="Unsent" caption="50 Worth $8,702,853.93" wrapCaption onSelect={() => {}} />);
    const card = cls(screen.getByRole("button"));
    // 81px with one line, 97px with two (uikit_wz_estimates): a floor, not a height.
    expect(card).toContain("min-h-[81px]");
    expect(card).not.toContain("h-[81px]");
    expect(cls(screen.getByText("50 Worth $8,702,853.93"))).not.toContain("truncate");
  });

  it("keeps the 81px box and the cut caption by default", () => {
    render(<WzKpiCard value="1" caption="a" />);
    expect(cls(screen.getByRole("group"))).toContain("h-[81px]");
    expect(cls(screen.getByText("a"))).toContain("truncate");
  });

  it("marks the chosen card with another rule instead of the grey (`left-orange`)", () => {
    const { rerender } = render(<WzKpiCard value="Won" caption="3 Worth $9.00" onSelect={() => {}} selectedTone="orange" />);
    expect(cls(screen.getByRole("button"))).toContain("border-l-foreground");
    rerender(<WzKpiCard value="Won" caption="3 Worth $9.00" onSelect={() => {}} selectedTone="orange" selected />);
    const chosen = cls(screen.getByRole("button"));
    expect(chosen).toContain("border-l-[#ffae00]");
    expect(chosen).not.toContain("border-l-foreground");
    expect(chosen).toContain("bg-background");
    expect(chosen).not.toContain("bg-[#f0f0f0]");
    expect(screen.getByRole("button")).toHaveAttribute("aria-pressed", "true");
  });
});

describe('WzKpiCard size="cardsBar" — the Call Tracking report\'s cards (`cardsBar`)', () => {
  it("prints a 20px figure over a 1.2em caption 10px under it", () => {
    render(<WzKpiCard size="cardsBar" value="2652" caption="Incoming calls" />);
    expect(cls(screen.getByText("2652"))).toEqual(expect.arrayContaining(["text-[20px]", "leading-[25px]", "font-medium"]));
    expect(cls(screen.getByText("Incoming calls"))).toEqual(expect.arrayContaining(["text-[16.8px]", "leading-4", "mt-2.5"]));
    expect(cls(screen.getByRole("group", { name: "Incoming calls" }))).toEqual(expect.arrayContaining(["h-[81px]", "border-l-[3px]"]));
  });

  it("leaves the list cards as they were", () => {
    render(<WzKpiCard value="370,358" caption="Clients" />);
    expect(cls(screen.getByText("370,358"))).toContain("text-[19.6px]");
    expect(cls(screen.getByText("Clients"))).toContain("text-sm");
  });
});
