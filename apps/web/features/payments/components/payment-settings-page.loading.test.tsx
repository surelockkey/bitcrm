import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { DEFAULT_PAYMENT_SETTINGS } from "@bitcrm/types";
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
 * Settings → Payments does not flash "No access".
 *
 * It opened on the refusal — the permissions had not answered yet, and a
 * permission not yet known read as a no — then a grey block, then the form.
 * Now one skeleton, then the form.
 */

const routes: FakeRoute[] = [
  { match: /\/users\/me$/, reply: () => ({ id: "u-admin", roleId: "role-admin", email: "a@x.test", firstName: "Ada", lastName: "Min" }), delayMs: 30 },
  { match: /\/billing\/payment-settings$/, reply: () => ({ ...DEFAULT_PAYMENT_SETTINGS, stripeConfigured: true }), delayMs: 40 },
];

let server: FakeServer;

const { PaymentSettingsPage } = await import("./payment-settings-page");

const pageUp = () => !!screen.queryByText("No access") || !!screen.queryByLabelText(/accept payments online/i);

beforeEach(() => {
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PaymentSettingsPage — no jumping", () => {
  it("goes from one skeleton to the form — never through No access", async () => {
    let refused = false;
    const observer = new MutationObserver(() => {
      if (screen.queryByText("No access")) refused = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const watch = watchFirstFrame(pageUp, () => ({
      form: !!screen.queryByLabelText(/accept payments online/i),
      skeletons: skeletonCount(),
    }));
    renderWithClient(<PaymentSettingsPage />);
    await screen.findByLabelText(/accept payments online/i, {}, { timeout: 3000 });
    await settle();
    watch.stop();
    observer.disconnect();

    expect(refused).toBe(false);
    expect(watch.frame()).toEqual({ form: true, skeletons: 0 });
    expect(duplicates(server.requests)).toEqual([]);
  });
});
