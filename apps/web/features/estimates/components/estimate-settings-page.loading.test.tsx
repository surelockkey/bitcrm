import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { DEFAULT_ESTIMATE_SETTINGS } from "@bitcrm/types";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeRoute,
  type FakeServer,
} from "@/test/page-load";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * Settings → Estimates shows itself once, whole: one skeleton while the
 * permissions and the switches are on the way, then the rows with the
 * switches already in their positions — never a "No access" flash, never
 * switches that flip once the settings land.
 */

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  { match: /\/billing\/estimate-settings$/, reply: () => ({ ...DEFAULT_ESTIMATE_SETTINGS, attachPdf: false }), delayMs: 40 },
];

let server: FakeServer;

const { EstimateSettingsPage } = await import("./estimate-settings-page");

const pageUp = () => !!screen.queryByText("No access") || !!screen.queryByRole("switch", { name: "Attach PDF files" });

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("EstimateSettingsPage — no jumping", () => {
  it("goes from one skeleton to the rows with the switches in place — never through No access", async () => {
    let refused = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByText("No access")) refused = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const watch = watchFirstFrame(pageUp, () => ({
      attachPdf: screen.queryByRole("switch", { name: "Attach PDF files" })?.getAttribute("aria-checked") ?? null,
      autoDecline:
        screen.queryByRole("switch", { name: "Auto-decline estimates related to the same job" })?.getAttribute("aria-checked") ?? null,
      skeletons: skeletonCount(),
    }));
    renderWithClient(<EstimateSettingsPage />);
    await screen.findByRole("switch", { name: "Attach PDF files" }, { timeout: 3000 });
    await settle();
    watch.stop();
    observer.disconnect();

    expect(refused).toBe(false);
    expect(watch.frame()).toEqual({ attachPdf: "false", autoDecline: "true", skeletons: 0 });
    expect(duplicates(server.requests)).toEqual([]);
  });
});
