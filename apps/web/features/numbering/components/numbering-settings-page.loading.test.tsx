import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
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
 * Settings → Numbering shows itself once, whole: one skeleton while the
 * permissions and the numbers are on the way, then the form — never a
 * "No access" flash while the permissions are still unknown, never a form
 * with empty boxes that fill in later.
 */

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  { match: /\/billing\/numbering$/, reply: () => ({ nextInvoiceNumber: 85427, nextEstimateNumber: 1142 }), delayMs: 40 },
];

let server: FakeServer;

const { NumberingSettingsPage } = await import("./numbering-settings-page");

const pageUp = () => !!screen.queryByText("No access") || !!screen.queryByLabelText("Next Invoice Id");

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("NumberingSettingsPage — no jumping", () => {
  it("goes from one skeleton to the filled form — never through No access", async () => {
    let refused = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByText("No access")) refused = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const watch = watchFirstFrame(pageUp, () => ({
      invoice: (screen.queryByLabelText("Next Invoice Id") as HTMLInputElement | null)?.value ?? null,
      estimate: (screen.queryByLabelText("Next Estimate Id") as HTMLInputElement | null)?.value ?? null,
      skeletons: skeletonCount(),
    }));
    renderWithClient(<NumberingSettingsPage />);
    await screen.findByLabelText("Next Invoice Id", {}, { timeout: 3000 });
    await settle();
    watch.stop();
    observer.disconnect();

    expect(refused).toBe(false);
    expect(watch.frame()).toEqual({ invoice: "85427", estimate: "1142", skeletons: 0 });
    expect(duplicates(server.requests)).toEqual([]);
  });
});
