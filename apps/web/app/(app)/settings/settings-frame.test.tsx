import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const nav = vi.hoisted(() => ({ pathname: "/settings/job-types" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ can: () => true, isLoading: false }),
}));

const { SettingsFrame } = await import("./settings-frame");

/**
 * Workiz has no settings rail: its settings home is the way to every page,
 * and each page is drawn edge to edge under its own grey band. The pages
 * rebuilt that way get no frame from the layout; the rest keep the old one
 * until their rebuild lands.
 */
describe("SettingsFrame", () => {
  it("draws nothing round a rebuilt page — no heading, no rail", () => {
    nav.pathname = "/settings/job-types";
    render(
      <SettingsFrame>
        <p>page</p>
      </SettingsFrame>,
    );
    expect(screen.getByText("page")).toBeInTheDocument();
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Settings" })).toBeNull();
  });

  it("draws nothing round the settings home either", () => {
    nav.pathname = "/settings";
    render(
      <SettingsFrame>
        <p>home</p>
      </SettingsFrame>,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("keeps the heading and the rail round a page not rebuilt yet", () => {
    nav.pathname = "/settings/companies";
    render(
      <SettingsFrame>
        <p>companies</p>
      </SettingsFrame>,
    );
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("navigation")).toBeInTheDocument();
    expect(screen.getByText("companies")).toBeInTheDocument();
  });
});
