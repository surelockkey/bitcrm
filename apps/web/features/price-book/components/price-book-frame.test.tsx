import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { PriceBookFrame, usePriceBookPageReady } from "./price-book-frame";

vi.mock("next/navigation", () => ({ usePathname: () => "/price-book/brands" }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

function Page({ allIn }: { allIn: boolean }) {
  const ready = usePriceBookPageReady(allIn);
  return <p>{ready ? "rows" : "loader"}</p>;
}

/**
 * The tab row comes with the page under it (app_audit 2026-10-09, finding
 * 18): while the page holds its loader the row holds its places; the frame
 * the page is whole in is the frame the names appear in — and they stay
 * through the next tab's load, as the Inventory frame's do.
 */
describe("PriceBookFrame", () => {
  it("holds the tabs' places until the page is whole, then draws the names in that frame", () => {
    const { rerender } = render(
      <PriceBookFrame>
        <Page allIn={false} />
      </PriceBookFrame>,
    );
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(screen.getByRole("navigation", { name: "Price Book sections" })).toHaveAttribute("aria-busy", "true");
    expect(document.querySelectorAll("[data-tab-placeholder]")).toHaveLength(3);

    rerender(
      <PriceBookFrame>
        <Page allIn />
      </PriceBookFrame>,
    );
    expect(screen.getByText("rows")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Item brands" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("navigation", { name: "Price Book sections" })).not.toHaveAttribute("aria-busy");
  });

  it("keeps the tabs drawn while the next tab loads", () => {
    const { rerender } = render(
      <PriceBookFrame>
        <Page allIn />
      </PriceBookFrame>,
    );
    rerender(
      <PriceBookFrame>
        <Page key="next" allIn={false} />
      </PriceBookFrame>,
    );
    expect(screen.getByText("loader")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Item brands" })).toBeInTheDocument();
  });

  it("is usePageReady for the page: latched once whole, so a refetch never takes the page away", () => {
    const { rerender } = render(
      <PriceBookFrame>
        <Page allIn />
      </PriceBookFrame>,
    );
    rerender(
      <PriceBookFrame>
        <Page allIn={false} />
      </PriceBookFrame>,
    );
    expect(screen.getByText("rows")).toBeInTheDocument();
  });

  it("reports to nobody outside the frame", () => {
    render(<Page allIn />);
    expect(screen.getByText("rows")).toBeInTheDocument();
  });
});
