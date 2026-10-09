import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PenLine } from "lucide-react";

import { WzButtonLink } from "./button";
import { WZ_MENU_POPUP, WZ_MENU_POPUP_ITEM } from "./menu-popup";
import { WzDocSectionHead, WzTotalsBoxRow } from "./document-parts";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const cls = (el: Element) => el.className.toString().split(/\s+/);

/*
 * The document pages' pieces (pg_estimate_wz_01_job): Button-module on a link
 * ("Price book", "Create new job"), the MenuPopup of "Actions", the section
 * heads ("Notes", "Signatures") and the totals' label + grey box rows.
 */
describe("WzButtonLink — WzButton's look on a link", () => {
  it("is a link with the Button-module pill: icon slot, then the 13px words", () => {
    render(
      <WzButtonLink href="/inventory/items" variant="secondary" size="regular" icon={<PenLine />}>
        Price book
      </WzButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Price book" });
    expect(link).toHaveAttribute("href", "/inventory/items");
    expect(cls(link)).toEqual(expect.arrayContaining(["rounded-pill", "border", "border-foreground", "px-3", "py-[6.5px]"]));
    expect(link.querySelector("[data-slot=wz-button-icon]")).not.toBeNull();
    expect(cls(screen.getByText("Price book"))).toEqual(expect.arrayContaining(["text-[13px]", "leading-[19px]", "font-semibold"]));
  });
});

describe("WZ_MENU_POPUP — Workiz's MenuPopup (the estimate's Actions)", () => {
  it("is a white 8px-cornered panel 8px in with Workiz's two-part shadow; rows are 35px of 13px ink", () => {
    expect(WZ_MENU_POPUP).toContain("rounded-[8px]");
    expect(WZ_MENU_POPUP).toContain("p-2");
    expect(WZ_MENU_POPUP).toContain("shadow-[0_0_4px_rgba(59,75,82,0.05),0_8px_16px_rgba(59,75,82,0.15)]");
    expect(WZ_MENU_POPUP_ITEM).toContain("min-h-[35px]");
    expect(WZ_MENU_POPUP_ITEM).toContain("text-[13px]");
    expect(WZ_MENU_POPUP_ITEM).toContain("pr-[23px]");
  });
});

describe("WzDocSectionHead — Notes / Signatures", () => {
  it("is a heading with its glyph, the 18px title and the action at the right, over a rule", () => {
    render(<WzDocSectionHead title="Signatures" icon={<PenLine data-testid="glyph" />} action={<button type="button">Sign</button>} />);
    const heading = screen.getByRole("heading", { name: "Signatures" });
    expect(cls(heading)).toEqual(expect.arrayContaining(["text-[18px]", "leading-[22px]", "font-medium"]));
    expect(screen.getByTestId("glyph")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign" })).toBeInTheDocument();
    expect(cls(heading.parentElement!)).toEqual(expect.arrayContaining(["border-b", "border-wz-rule"]));
  });
});

describe("WzTotalsBoxRow — a label and its grey box", () => {
  it("prints 'Subtotal :' beside a 132×28 box", () => {
    render(<WzTotalsBoxRow label="Subtotal">912.17</WzTotalsBoxRow>);
    const row = screen.getByRole("group", { name: "Subtotal" });
    expect(row).toHaveTextContent("Subtotal :912.17");
    expect(cls(screen.getByText("912.17"))).toEqual(expect.arrayContaining(["h-7", "w-[132px]", "bg-[#f7f7f7]"]));
  });

  it("underlines a label that opens something, and makes its box a button", async () => {
    const onClick = vi.fn();
    render(
      <WzTotalsBoxRow label="Deposit" underline onClick={onClick}>
        501.70 (50.00%)
      </WzTotalsBoxRow>,
    );
    expect(cls(screen.getByText("Deposit :"))).toContain("underline");
    await userEvent.click(screen.getByRole("button", { name: /501\.70/ }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("drops the space before the colon when asked (Workiz's 'Discount:')", () => {
    render(<WzTotalsBoxRow label="Discount" colon="tight">0.00</WzTotalsBoxRow>);
    expect(screen.getByText("Discount:")).toBeInTheDocument();
  });
});
