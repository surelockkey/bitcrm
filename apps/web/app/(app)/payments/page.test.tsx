import { describe, it, expect, vi, beforeEach } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import Page from "./page";

/**
 * The Payments report used to sit in the sidebar at /payments. Workiz keeps
 * it under Reports, so it moved to /reports/payments; the old address still
 * lands on it for bookmarks and old notes.
 */
describe("/payments", () => {
  beforeEach(() => redirect.mockReset());

  it("sends the old address to the report under Reports", () => {
    Page();
    expect(redirect).toHaveBeenCalledWith("/reports/payments");
  });
});
