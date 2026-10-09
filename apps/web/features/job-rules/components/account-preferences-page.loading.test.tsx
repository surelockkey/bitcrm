import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { duplicates, installFakeServer, renderWithClient, settle, skeletonCount, type FakeServer } from "@/test/page-load";
import { AccountPreferencesPage } from "./account-preferences-page";

/**
 * Settings → Account Preferences appears once, whole: one skeleton until the
 * rules and the right to change them are in, then the toggle row, switchable,
 * in the same frame — whichever answer comes last.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/preferences",
}));

const me = { id: "u-admin", firstName: "Ada", lastName: "Admin", email: "ada@example.com", roleId: "role-admin" };

interface Frame {
  skeletons: number;
  toggle: boolean;
  editable: boolean;
}

function recordFrames(probe: () => Frame) {
  const frames: Frame[] = [];
  let last = "";
  const observer = new MutationObserver(() => {
    const f = probe();
    const key = JSON.stringify(f);
    if (key !== last) {
      frames.push(f);
      last = key;
    }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
  return { frames: () => frames, stop: () => observer.disconnect() };
}

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AccountPreferencesPage — loading", () => {
  it.each([
    ["the rules come last", { rules: 90, me: 20 }],
    ["the user comes last", { rules: 20, me: 90 }],
  ])("shows the row switchable in one frame when %s", async (_label, delay) => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => me, delayMs: delay.me },
      { match: /\/deals\/job-rules$/, reply: () => ({ updateJobEndTimeOnClose: true }), delayMs: delay.rules },
    ]);
    const rec = recordFrames(() => {
      const toggle = screen.queryByRole("switch", { name: "Update Job End Time" });
      return { skeletons: skeletonCount(), toggle: !!toggle, editable: !!toggle && !toggle.hasAttribute("disabled") };
    });

    renderWithClient(<AccountPreferencesPage />);
    await screen.findByRole("switch", { name: "Update Job End Time" });
    await settle();
    rec.stop();
    const frames = rec.frames();

    const first = frames.findIndex((f) => f.toggle);
    for (const f of frames.slice(0, first)) expect(f.skeletons).toBeGreaterThan(0);
    expect(frames[first]).toEqual({ skeletons: 0, toggle: true, editable: true });
    expect(duplicates(server.requests)).toEqual([]);
  });
});
