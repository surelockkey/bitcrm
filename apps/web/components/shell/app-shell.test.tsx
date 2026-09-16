import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppShell } from "./app-shell";

// The shell's children each own a live connection (SSE, Twilio, geolocation)
// or a query; none of them is what this file is about.
vi.mock("./app-sidebar", () => ({ AppSidebar: () => null }));
vi.mock("./app-header", () => ({ AppHeader: () => <header>header</header> }));
vi.mock("./page-history", () => ({ PageHistoryBar: () => null }));
vi.mock("./command-menu", () => ({ CommandMenu: () => null }));
vi.mock("@/features/technicians/components/location-broadcaster", () => ({
  LocationBroadcaster: () => null,
}));
vi.mock("@/features/telephony/components/softphone-provider", () => ({
  SoftphoneProvider: () => null,
}));
vi.mock("@/features/messaging/components/messaging-stream-provider", () => ({
  MessagingStreamProvider: () => null,
}));
vi.mock("@/features/messaging/components/inbox-sidebar-collapse", () => ({
  InboxSidebarCollapse: () => null,
}));

// Whether the run starts in apps/web or at the repo root.
const globalsCssPath = ["app/globals.css", "apps/web/app/globals.css"]
  .map((p) => path.join(process.cwd(), p))
  .find((p) => existsSync(p));
const globalsCss = globalsCssPath ? readFileSync(globalsCssPath, "utf8") : "";

/**
 * `viewport-fit: cover` (app/layout.tsx) gives the page the whole phone
 * screen, notch and home indicator included. These two assertions are the
 * other half of that: the shell asks for the insets, and the stylesheet
 * actually applies them.
 */
describe("AppShell — safe-area insets", () => {
  it("insets the shell so the header clears the notch and the scroll areas clear the home indicator", () => {
    const { container } = render(
      <AppShell>
        <p>page</p>
      </AppShell>,
    );

    const wrapper = container.querySelector('[data-slot="sidebar-wrapper"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper).toHaveClass("app-safe-area");
    // Still bounded to the viewport: with border-box the insets come out of
    // that height rather than pushing the shell off the bottom of the screen.
    expect(wrapper).toHaveClass("h-svh");
    expect(screen.getByText("page")).toBeInTheDocument();
  });

  it("defines the class with all four insets", () => {
    const rule = /\.app-safe-area\s*\{([^}]*)\}/.exec(globalsCss)?.[1] ?? "";
    for (const side of ["top", "right", "bottom", "left"]) {
      expect(rule).toContain(`padding-${side}: env(safe-area-inset-${side}`);
    }
  });
});
