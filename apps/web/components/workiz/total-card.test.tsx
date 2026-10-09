import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { WzTotalCard } from "./total-card";

const cls = (el: Element) => el.className.toString().split(/\s+/);

/*
 * The Payments report's two cards (rep_payments_wz_01_default,
 * `PaymentsReport-module__cardContainer`): 188×72, white, 8px corners, a soft
 * two-part shadow, a 4px ink bar down the left; the figure 16px/24px 500 ink
 * over a 14px/21px #768287 caption, 20px / 16px in.
 */
describe("WzTotalCard — the Payments report's total card", () => {
  it("prints the figure over its caption, named by the caption", () => {
    render(<WzTotalCard value="$130,302.80" caption="Total amount" />);
    const card = screen.getByRole("group", { name: "Total amount" });
    expect(card).toHaveTextContent("$130,302.80Total amount");
    expect(cls(card)).toEqual(expect.arrayContaining(["w-[188px]", "h-[72px]", "rounded-[8px]"]));
    expect(cls(screen.getByText("$130,302.80"))).toEqual(
      expect.arrayContaining(["text-base", "leading-6", "font-medium", "tracking-[0.2px]", "text-foreground"]),
    );
    expect(cls(screen.getByText("Total amount"))).toEqual(expect.arrayContaining(["text-sm", "leading-[21px]", "text-wz-outline-label"]));
  });

  it("draws the 4px ink bar down its left edge", () => {
    render(<WzTotalCard value="$0.00" caption="Total tips" />);
    const bar = screen.getByRole("group", { name: "Total tips" }).querySelector("[data-slot=wz-total-card-bar]")!;
    expect(cls(bar)).toEqual(expect.arrayContaining(["w-1", "bg-foreground"]));
  });

  it("is a figure, not a control", () => {
    render(<WzTotalCard value="$0.00" caption="Total tips" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
