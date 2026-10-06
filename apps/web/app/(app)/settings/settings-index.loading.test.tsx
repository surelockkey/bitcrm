import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { duplicates, installFakeServer, renderWithClient, settle, skeletonCount, type FakeServer } from "@/test/page-load";
import { SettingsIndex } from "./settings-index";

/**
 * The settings index appears once, whole.
 *
 * Each section shows only to whoever may open it, and until the signed-in
 * user had come the answer was "nobody": the list stood at its one
 * unguarded row, "General", and then grew to twenty under the reader. Now it
 * holds one skeleton until the permissions are in and draws every section
 * the reader may open, at once.
 */

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const me = { id: "u-admin", firstName: "Ada", lastName: "Admin", email: "ada@example.com", roleId: "role-admin" };

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("SettingsIndex — loading", () => {
  it("never shows the list half-drawn", async () => {
    server = installFakeServer([{ match: /\/users\/me$/, reply: () => me, delayMs: 60 }]);
    const frames: { links: number; skeletons: number }[] = [];
    let last = "";
    const observer = new MutationObserver(() => {
      const f = { links: document.querySelectorAll("a[href^='/settings'], a[href='/automations']").length, skeletons: skeletonCount() };
      const key = JSON.stringify(f);
      if (key !== last) {
        frames.push(f);
        last = key;
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });

    renderWithClient(<SettingsIndex />);
    await screen.findByText("Job Types");
    await settle();
    observer.disconnect();

    const full = frames.at(-1)!.links;
    expect(full).toBeGreaterThan(10);
    // Every frame is either the skeleton or the whole list.
    for (const f of frames) {
      if (f.links === 0) expect(f.skeletons).toBeGreaterThan(0);
      else expect(f).toEqual({ links: full, skeletons: 0 });
    }
    expect(duplicates(server.requests)).toEqual([]);
  });
});
