import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import {
  duplicates,
  installFakeServer,
  renderWithClient,
  settle,
  skeletonCount,
  type FakeServer,
} from "@/test/page-load";
import { JobFieldsPage } from "./job-fields-page";

/**
 * Settings → Job Fields appears once, whole.
 *
 * Its two cards loaded apart: "Default fields" held a 160px grey bar until
 * the settings came, and "Custom fields" drew nothing until the definitions
 * did. Whichever came second moved the page — the default list is taller than
 * its bar, so the custom-fields card slid down under the reader (CLS 0.026 on
 * the dev site). Now one skeleton holds both until both are in.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/job-fields",
}));

const me = { id: "u-admin", firstName: "Ada", lastName: "Admin", email: "ada@example.com", roleId: "role-admin" };

const field = {
  id: "cf-door",
  name: "Door Color",
  type: "text",
  group: "Site",
  options: [],
  jobTypeIds: [],
  required: false,
  requiredToClose: false,
  searchable: false,
  priority: 1,
  active: true,
  createdBy: "u-admin",
  createdAt: "",
  updatedAt: "",
};

interface Frame {
  skeletons: number;
  defaults: boolean;
  custom: boolean;
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

describe("JobFieldsPage — loading", () => {
  it.each([
    ["the custom fields come last", { settings: 20, custom: 90, me: 20 }],
    ["the settings come last", { settings: 90, custom: 20, me: 20 }],
    ["the user comes last", { settings: 20, custom: 20, me: 90 }],
  ])("shows both cards in one frame when %s", async (_label, delay) => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => me, delayMs: delay.me },
      { match: /\/deals\/job-field-settings$/, reply: () => ({ requiredFields: { address: true } }), delayMs: delay.settings },
      { match: /\/deals\/custom-fields$/, reply: () => [field], delayMs: delay.custom },
    ]);
    const rec = recordFrames(() => {
      const address = screen.queryByRole("switch", { name: "Service address" });
      return {
        skeletons: skeletonCount(),
        defaults: !!address,
        custom: !!screen.queryByRole("switch", { name: "Door Color" }),
        editable: !!address && !address.hasAttribute("disabled"),
      };
    });

    renderWithClient(<JobFieldsPage />);
    await screen.findByRole("switch", { name: "Door Color" });
    await screen.findByRole("switch", { name: "Service address" });
    await settle();
    rec.stop();
    const frames = rec.frames();

    const first = frames.findIndex((f) => f.defaults || f.custom);
    for (const f of frames.slice(0, first)) expect(f.skeletons).toBeGreaterThan(0);
    // Both cards, switchable, and no grey bar left — in the same frame.
    expect(frames[first]).toEqual({ skeletons: 0, defaults: true, custom: true, editable: true });
    expect(frames.slice(first).every((f) => f.defaults && f.custom)).toBe(true);
    expect(duplicates(server.requests)).toEqual([]);
  });
});
