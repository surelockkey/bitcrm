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
