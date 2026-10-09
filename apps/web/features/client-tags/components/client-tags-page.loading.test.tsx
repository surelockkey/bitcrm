import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  watchFirstFrame,
  type FakeServer,
} from "@/test/page-load";

/**
 * Settings → Client tags appears once, whole.
 *
 * Until the permissions came it said "No access" — a refusal it had not yet
 * earned — and then the tags turned up, with the "Add New" button
 * arriving on its own beat. Now it waits behind one skeleton for both.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/client-tags",
}));

let server: FakeServer;

const { ClientTagsPage } = await import("./client-tags-page");

const text = () => document.body.textContent ?? "";
const tagsUp = () => !!screen.queryByText("VIP");

beforeEach(() => {
  server = installFakeServer([
    // The tags first, the permissions a beat later — as the browser sees them.
    { match: /\/deals\/client-tags$/, reply: () => [{ id: "t-vip", name: "VIP", color: "blue", priority: 1, active: true }] },
    { match: /\/users\/me$/, reply: () => ({ id: "u1", firstName: "Dee", lastName: "Spatch", email: "dee@example.com", roleId: "role-super-admin" }), delayMs: 90 },
  ]);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ClientTagsPage — one load, not waves", () => {
  it("never says 'No access' while the permissions are on their way", async () => {
    let refused = false;
    const observer = new MutationObserver(() => {
      if (text().includes("No access")) refused = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    renderWithClient(<ClientTagsPage />);
    await screen.findByText("VIP", {}, { timeout: 3000 });
    observer.disconnect();

    expect(refused).toBe(false);
  });

  it("draws the tags and the Add New button in one frame", async () => {
    const watch = watchFirstFrame(tagsUp, () => ({
      newTag: !!screen.queryByRole("button", { name: /^add new$/i }),
      editButtons: screen.queryAllByRole("button", { name: /^Edit / }).length,
      skeletons: skeletonCount(),
    }));
    renderWithClient(<ClientTagsPage />);
    await screen.findByText("VIP", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ newTag: true, editButtons: 1, skeletons: 0 });
  });

  it("the other order — the permissions first, the tags late: the button still waits for the tags", async () => {
    server = installFakeServer([
      { match: /\/deals\/client-tags$/, reply: () => [{ id: "t-vip", name: "VIP", color: "blue", priority: 1, active: true }], delayMs: 120 },
      { match: /\/users\/me$/, reply: () => ({ id: "u1", firstName: "Dee", lastName: "Spatch", email: "dee@example.com", roleId: "role-super-admin" }) },
    ]);
    const watch = watchFirstFrame(
      () => !!screen.queryByRole("button", { name: /^add new$/i }),
      () => ({ tags: tagsUp(), skeletons: skeletonCount() }),
    );
    renderWithClient(<ClientTagsPage />);
    await screen.findByText("VIP", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ tags: true, skeletons: 0 });
  });

  it("asks for each thing once", async () => {
    renderWithClient(<ClientTagsPage />);
    await screen.findByText("VIP", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
