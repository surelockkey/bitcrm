import { describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

const { default: Page } = await import("./page");

/**
 * General used to be a page of its own that said only "preferences will live
 * here" — clicked, it opened onto nothing. General is now the settings screen
 * itself, and an old link to the empty page lands there.
 */
describe("/settings/general", () => {
  it("sends the reader to the settings screen", () => {
    Page();
    expect(redirect).toHaveBeenCalledWith("/settings");
  });
});
