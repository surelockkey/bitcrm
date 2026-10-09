import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WzBadgeIconButton, WzPageHeader, WzStatCard, WzTabLinks } from "./page-parts";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * The Workiz Phone page's frame (callspage_wz_01): the header with its number
 * pill, the tab strip, the stat cards and the headset with its count.
 */
describe("WzPageHeader", () => {
  it("is the page's heading, with the pill beside it when there is one", () => {
    render(<WzPageHeader title="Phone" pill={<span>(203) 403-6303</span>} />);
    expect(screen.getByRole("heading", { level: 2, name: "Phone" })).toBeInTheDocument();
    expect(screen.getByText("(203) 403-6303")).toBeInTheDocument();
  });
});

describe("WzTabLinks", () => {
  it("links every tab and marks the open one", () => {
    render(
      <WzTabLinks
        label="Phone"
        active="numbers"
        tabs={[
          { id: "calls", label: "Calls", href: "/calls" },
          { id: "numbers", label: "Phone numbers", href: "/calls/numbers" },
        ]}
      />,
    );
    expect(screen.getByRole("navigation", { name: "Phone" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Calls" })).toHaveAttribute("href", "/calls");
    expect(screen.getByRole("link", { name: "Phone numbers" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Calls" })).not.toHaveAttribute("aria-current");
  });
});

describe("WzTabLinks variant page (pg_pricebook)", () => {
  const tabs = [
    { id: "items", label: "Items & products", href: "/price-book/items" },
    { id: "brands", label: "Item brands", href: "/price-book/brands" },
  ];

  it("draws Workiz's big _tabs: 16px words, 15px 25px, 600 on white with the 4px bar when open", () => {
    render(<WzTabLinks label="Price book" active="items" tabs={tabs} variant="page" />);
    const open = screen.getByRole("link", { name: "Items & products" });
    expect(open.className).toContain("text-base");
    expect(open.className).toContain("px-[25px]");
    expect(open.className).toContain("font-semibold");
    expect(open.className).toContain("after:h-1");
    expect(screen.getByRole("link", { name: "Item brands" }).className).toContain("font-medium");
  });

  it("holds each tab's place, not a link, while pending", () => {
    render(<WzTabLinks label="Price book" active="items" tabs={tabs} variant="page" pending />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("navigation", { name: "Price book" })).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll("[data-tab-placeholder]")).toHaveLength(2);
  });

  it("takes the caller's spacing", () => {
    render(<WzTabLinks label="Price book" active="items" tabs={tabs} variant="page" className="mt-5" />);
    expect(screen.getByRole("navigation", { name: "Price book" }).className).toContain("mt-5");
  });
});

describe("WzStatCard", () => {
  it("shows the label, the number and the words beside it", () => {
    render(<WzStatCard label="CALLS" value="647" aside="226 callers" />);
    const card = screen.getByRole("group", { name: "CALLS" });
    expect(card).toHaveTextContent("647");
    expect(card).toHaveTextContent("226 callers");
  });

  it("turns label and number red as an alert", () => {
    render(<WzStatCard label="MISSED CALLS" value="59" alert />);
    expect(screen.getByText("59").className).toContain("text-wz-danger");
    expect(screen.getByText("MISSED CALLS").className).toContain("text-wz-danger");
  });
});

describe("WzBadgeIconButton", () => {
  it("names itself and shows its count only when there is one", async () => {
    const onClick = vi.fn();
    const { rerender } = render(<WzBadgeIconButton label="Monitor calls" count={5} onClick={onClick} icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Monitor calls" })).toHaveTextContent("5");
    await userEvent.click(screen.getByRole("button", { name: "Monitor calls" }));
    expect(onClick).toHaveBeenCalled();
    rerender(<WzBadgeIconButton label="Monitor calls" count={0} onClick={onClick} icon={<svg />} />);
    expect(screen.getByRole("button", { name: "Monitor calls" })).not.toHaveTextContent("0");
  });
});
