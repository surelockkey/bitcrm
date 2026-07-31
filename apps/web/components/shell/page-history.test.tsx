import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { PageHistoryBar, usePageHistoryLabel } from "./page-history";
import { usePageHistoryStore } from "@/stores/page-history-store";

const mocks = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
}));

// next/link needs the App Router context; swap it for a plain anchor.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

function trail() {
  return screen.getByRole("navigation", { name: /recently visited/i });
}

beforeEach(() => {
  mocks.pathname = "/";
  usePageHistoryStore.setState({ visits: [] });
});

describe("PageHistoryBar", () => {
  it("records the current page and shows it as the current trail item", () => {
    mocks.pathname = "/deals";
    render(<PageHistoryBar />);

    const current = within(trail()).getByText("Jobs");
    expect(current).toHaveAttribute("aria-current", "page");
  });

  it("appends pages in visit order and links previous ones", () => {
    mocks.pathname = "/settings";
    const { rerender } = render(<PageHistoryBar />);
    mocks.pathname = "/admin/users";
    rerender(<PageHistoryBar />);
    mocks.pathname = "/deals";
    rerender(<PageHistoryBar />);

    const links = within(trail()).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      "Settings",
      "Users",
      "Jobs",
    ]);
    expect(links[0]).toHaveAttribute("href", "/settings");
    expect(links[1]).toHaveAttribute("href", "/admin/users");
    expect(links[2]).toHaveAttribute("aria-current", "page");
  });

  it("moves a re-visited page to the end instead of duplicating it", () => {
    mocks.pathname = "/settings";
    const { rerender } = render(<PageHistoryBar />);
    mocks.pathname = "/deals";
    rerender(<PageHistoryBar />);
    mocks.pathname = "/settings";
    rerender(<PageHistoryBar />);

    const links = within(trail()).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Jobs", "Settings"]);
  });

  it("shows at most the 6 most recent pages", () => {
    const paths = [
      "/",
      "/deals",
      "/contacts",
      "/companies",
      "/technicians",
      "/schedule",
      "/settings",
    ];
    mocks.pathname = paths[0];
    const { rerender } = render(<PageHistoryBar />);
    for (const p of paths.slice(1)) {
      mocks.pathname = p;
      rerender(<PageHistoryBar />);
    }

    const links = within(trail()).getAllByRole("link");
    expect(links).toHaveLength(6);
    expect(links[0]).toHaveTextContent("Jobs");
    expect(within(trail()).queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("persists the trail so it survives a reload", () => {
    mocks.pathname = "/deals";
    render(<PageHistoryBar />);

    const stored = localStorage.getItem("bitcrm.page-history");
    expect(stored).toContain("/deals");
  });
});

describe("usePageHistoryLabel", () => {
  function DealPage({ label }: { label?: string }) {
    usePageHistoryLabel(label);
    return null;
  }

  it("upgrades the current page's label once it is known", () => {
    mocks.pathname = "/deals/d1";
    const { rerender } = render(
      <>
        <PageHistoryBar />
        <DealPage />
      </>,
    );
    expect(within(trail()).getByText("Job")).toBeInTheDocument();

    rerender(
      <>
        <PageHistoryBar />
        <DealPage label="Job (3QI2BN)" />
      </>,
    );
    expect(within(trail()).getByText("Job (3QI2BN)")).toBeInTheDocument();
    expect(within(trail()).queryByText("Job")).not.toBeInTheDocument();
  });

  it("does nothing while the label is still unknown", () => {
    mocks.pathname = "/deals/d1";
    render(
      <>
        <PageHistoryBar />
        <DealPage />
      </>,
    );
    expect(within(trail()).getByText("Job")).toBeInTheDocument();
  });
});
