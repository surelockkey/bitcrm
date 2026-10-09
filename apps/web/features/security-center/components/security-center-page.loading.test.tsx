import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { DEFAULT_SECURITY_SETTINGS } from "@bitcrm/types";
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

/**
 * Settings → Security Center comes whole: one skeleton while the permissions
 * and the account's switches load, then the page — never a flash of "No
 * access" (a permission not yet known reads as a no), never the rows
 * arriving one by one.
 */

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  { match: /\/users\/security-settings$/, reply: () => ({ ...DEFAULT_SECURITY_SETTINGS, requireMfa: true }), delayMs: 40 },
];

let server: FakeServer;

const { SecurityCenterPage } = await import("./security-center-page");

const row = () => screen.queryByRole("switch", { name: "Require Two-factor authentication (2FA)" });
const pageUp = () => !!screen.queryByText("No access") || !!row();

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SecurityCenterPage — no jumping", () => {
  it("goes from one skeleton to the whole page — never through No access", async () => {
    let refused = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByText("No access")) refused = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const watch = watchFirstFrame(pageUp, () => ({
      rows: screen.queryAllByRole("switch").length,
      required: row()?.getAttribute("aria-checked"),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<SecurityCenterPage />);
    await screen.findByRole("switch", { name: "Require Two-factor authentication (2FA)" }, { timeout: 3000 });
    await settle();
    watch.stop();
    observer.disconnect();

    expect(refused).toBe(false);
    expect(watch.frame()).toEqual({ rows: 3, required: "true", skeletons: 0 });
    expect(duplicates(server.requests)).toEqual([]);
    expect(server.unanswered).toEqual([]);
  });
});
