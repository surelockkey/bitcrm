import { render, screen, within } from "@testing-library/react";
import { Wrench } from "lucide-react";
import { describe, expect, it } from "vitest";

import { WzHubCard, WzHubCardSkeleton, WzHubGrid } from "./hub-cards";

// The attribute, not `className`: an <svg>'s className is an SVGAnimatedString.
const cls = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/);

const grid = () =>
  render(
    <WzHubGrid aria-label="Reports">
      <WzHubCard href="/reports/jobs" title="Jobs" icon={Wrench} />
      <WzHubCard href="/estimates" title="Estimates" icon={Wrench} />
    </WzHubGrid>,
  );

describe("WzHubGrid + WzHubCard — the Reports hub's cards (rep_hub_wz_01_default)", () => {
  it("is a list of links, each named by its title and opening its page", () => {
    grid();
    const list = screen.getByRole("list", { name: "Reports" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(within(list).getByRole("link", { name: "Jobs" })).toHaveAttribute("href", "/reports/jobs");
    expect(within(list).getByRole("link", { name: "Estimates" })).toHaveAttribute("href", "/estimates");
  });

  it("draws Workiz's card: a 3px ink rule on the left, 15px in, the two-part shadow, 1px corners", () => {
    grid();
    const card = cls(screen.getByRole("link", { name: "Jobs" }));
    expect(card).toEqual(
      expect.arrayContaining([
        "border-l-[3px]",
        "border-l-foreground",
        "p-[15px]",
        "rounded-[1px]",
        "shadow-[0_1px_3px_rgba(0,0,0,0.16),0_2px_10px_rgba(0,0,0,0.12)]",
      ]),
    );
  });

  it("prints the title 16px/16px medium ink and the glyph #404040 at the right, as big as Workiz's 30px Linearicons ink", () => {
    grid();
    const link = screen.getByRole("link", { name: "Jobs" });
    const title = link.querySelector('[data-slot="wz-hub-card-title"]')!;
    expect(title).toHaveTextContent("Jobs");
    expect(cls(title)).toEqual(expect.arrayContaining(["text-base", "leading-4", "font-medium", "text-foreground"]));
    const icon = link.querySelector("svg")!;
    expect(icon).toHaveAttribute("aria-hidden", "true");
    // Lucide's ink is 20/24 of its box: 34px draws ~28px of ink, centred where
    // Workiz's 30px glyph box sits (10px down, 20px in from the right).
    expect(icon).toHaveAttribute("width", "34");
    expect(cls(icon)).toEqual(expect.arrayContaining(["top-2", "right-[18px]"]));
    expect(cls(icon)).toEqual(expect.arrayContaining(["absolute", "text-wz-strong"]));
  });

  it("lifts on hover and on keyboard focus with .c_hover's drop shadow (rep_hub_wz_02_hover_jobs)", () => {
    grid();
    const column = cls(screen.getAllByRole("listitem")[0]);
    expect(column).toContain("hover:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4)]");
    expect(column).toContain("has-[:focus-visible]:shadow-[0_12px_12px_-8px_rgba(0,0,0,0.4)]");
    expect(column).toContain("transition-[box-shadow,transform]");
  });

  it("lays the cards out on Developr's grid: one, two from 768px, three from 1200px", () => {
    grid();
    expect(cls(screen.getByRole("list"))).toEqual(expect.arrayContaining(["ml-[-2.25%]", "p-5", "flex-wrap"]));
    expect(cls(screen.getAllByRole("listitem")[0])).toEqual(
      expect.arrayContaining(["ml-[2.25%]", "w-[97.75%]", "min-[768px]:w-[47.75%]", "min-[1200px]:w-[31.0833%]", "mb-5", "min-[1200px]:mb-[25px]"]),
    );
  });

  it("has a skeleton of the same card", () => {
    render(
      <WzHubGrid aria-label="Loading">
        <WzHubCardSkeleton />
      </WzHubGrid>,
    );
    const skeleton = screen.getByTestId("wz-hub-card-skeleton");
    expect(cls(skeleton)).toEqual(expect.arrayContaining(["border-l-[3px]", "h-[46px]"]));
    expect(screen.getByRole("listitem")).toContainElement(skeleton);
  });
});
