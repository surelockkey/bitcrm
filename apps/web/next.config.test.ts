import { describe, expect, it } from "vitest";
import nextConfig from "./next.config";

/**
 * The addresses that only send the reader on — /payments to the report under
 * Reports, /inventory and /price-book to their Items tab, the old phone and
 * automation settings to the Phone tabs and the module — are turned round
 * before anything renders.
 *
 * Each has a page file calling `redirect()`, and that stays for the bookmarks;
 * but inside the streamed app shell such a redirect is a meta refresh, so the
 * browser first drew the old address — the settings rail, the Inventory frame,
 * a skeleton — then the real page over it: two skeletons, the sidebar jumping
 * from the 48px rail to its full width (CLS 0.10–0.13), and the old address
 * left standing in the breadcrumb trail (app_audit 2026-10-09, findings 3, 5
 * and the "PAYMENTS # PAYMENTS" crumb). A 307 from next.config.js is answered
 * before the filesystem is consulted, on a typed address and on a Link alike.
 */
describe("next.config redirects", () => {
  it.each([
    ["/payments", "/reports/payments"],
    ["/inventory", "/inventory/items"],
    ["/price-book", "/price-book/items"],
    ["/settings/general", "/settings"],
    ["/settings/automations", "/automations"],
    ["/settings/phone-numbers", "/calls/numbers"],
    ["/settings/call-flows", "/calls/flows"],
    ["/settings/call-groups", "/calls/groups"],
    ["/settings/messaging", "/calls/texting"],
    ["/settings/message-templates", "/calls/texting"],
  ])("turns %s round to %s before it renders", async (source, destination) => {
    const list = await nextConfig.redirects!();
    expect(list).toContainEqual({ source, destination, permanent: false });
  });

  it("keeps the portal's hand-over", async () => {
    const list = await nextConfig.redirects!();
    expect(list.some((r) => r.source.startsWith("/portal/"))).toBe(true);
  });
});
