import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { createTemplateContent } from "@bitcrm/document-renderer";
import { duplicates, installFakeServer, renderWithClient, settle, type FakeServer } from "@/test/page-load";
import { DocumentsSettingsPage } from "./documents-settings-page";

/**
 * Settings → Documents shows its templates once, whole.
 *
 * It filled in over a second: "No access" while the user was on the way,
 * grey placeholders, then the rows — and the "Auto-applies to" cells
 * rewrote themselves when the job types, areas and companies they name came
 * in ("1 more job type" → "Rekey Visit").
 *
 * Now the templates and the names they print are asked for at once, and the
 * rows come in one frame. (The grid is Workiz's: no page pictures, so no
 * template is asked for in full.)
 */

/** The page's `?tab=`. */
let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/settings/documents",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const me = { id: "u-admin", firstName: "Ada", lastName: "Admin", email: "ada@example.com", roleId: "role-admin" };

const summary = (id: string, name: string, kind: "invoice" | "estimate", jobTypeIds: string[]) => ({
  id,
  name,
  kind,
  isDefault: false,
  autoApply: { jobTypeIds, serviceAreaIds: [], businessProfileIds: [] },
  version: 1,
  createdBy: "u-admin",
  createdAt: "",
  updatedAt: "2026-01-02T00:00:00.000Z",
});

const list = [summary("tpl-inv", "House invoice", "invoice", ["jt-rekey"]), summary("tpl-est", "House estimate", "estimate", [])];

const detail = (id: string) => {
  const s = list.find((t) => t.id === id)!;
  return { ...s, ...createTemplateContent(s.kind, "classic") };
};

let server: FakeServer;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  search = "";
});

interface Frame {
  noAccess: boolean;
  placeholders: number;
  cards: number;
  pages: number;
  summary: string | null;
  newButton: boolean;
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

describe("DocumentsSettingsPage — loading", () => {
  it("goes from one skeleton to the rows and their auto-apply cells in one frame", async () => {
    server = installFakeServer([
      { match: /\/users\/me$/, reply: () => me, delayMs: 30 },
      { match: /\/billing\/templates$/, reply: () => list, delayMs: 20 },
      { match: /\/billing\/templates\/tpl-(inv|est)$/, reply: (url) => detail(url.pathname.split("/").pop()!), delayMs: 20 },
      // The names come last, the order that rewrote the rows.
      { match: /\/deals\/job-types$/, reply: () => [{ id: "jt-rekey", name: "Rekey Visit", priority: 1, active: true }], delayMs: 90 },
      { match: /\/deals\/service-areas$/, reply: () => [], delayMs: 90 },
      { match: /\/billing\/business-profiles$/, reply: () => [{ id: "bp-1", name: "Northside Locks", isDefault: true, active: true }], delayMs: 90 },
    ]);
    const rec = recordFrames(() => ({
      noAccess: !!screen.queryByText("No access"),
      placeholders: document.querySelectorAll('[data-slot="skeleton"], .animate-pulse').length,
      cards: document.querySelectorAll('tbody tr a[href^="/settings/documents/"]').length,
      pages: 0,
      summary: screen.queryByText(/Rekey/)?.textContent ?? null,
      newButton: !!screen.queryByRole("button", { name: /add new template/i }),
    }));

    renderWithClient(<DocumentsSettingsPage />);
    await screen.findByText("House invoice");
    await screen.findByText("Rekey Visit");
    await settle();
    rec.stop();
    const frames = rec.frames();

    expect(frames.some((f) => f.noAccess)).toBe(false);
    const first = frames.findIndex((f) => f.cards > 0);
    for (const f of frames.slice(0, first)) expect(f.placeholders).toBeGreaterThan(0);
    expect(frames[first]).toEqual({
      noAccess: false,
      placeholders: 0,
      cards: 2,
      pages: 0,
      summary: "Rekey Visit",
      newButton: true,
    });
    expect(duplicates(server.requests)).toEqual([]);
    expect(server.unanswered).toEqual([]);
    // The grid draws no page pictures: no template is fetched in full.
    expect(server.requests.filter((r) => /\/billing\/templates\/tpl-/.test(r))).toEqual([]);
  });

  it.each([
    ["defaults", /estimate notes/i],
    ["messages", /subject/i],
  ])("draws the %s tab with its Save button, not before it", async (tab, field) => {
    search = `tab=${tab}`;
    server = installFakeServer([
      // The settings first and the user last: the form used to come up
      // read-only and grow its Save button a beat later.
      { match: /\/users\/me$/, reply: () => me, delayMs: 90 },
      { match: /\/billing\/document-settings$/, reply: () => ({}), delayMs: 20 },
    ]);
    const formUp = () => screen.queryAllByText(field).length > 0;
    const rec = recordFrames(() => ({
      noAccess: !!screen.queryByText("No access"),
      placeholders: document.querySelectorAll('[data-slot="skeleton"]').length,
      cards: formUp() ? 1 : 0,
      pages: 0,
      summary: null,
      newButton: !!screen.queryByRole("button", { name: /^save$/i }),
    }));

    renderWithClient(<DocumentsSettingsPage />);
    await screen.findByRole("button", { name: /^save$/i });
    await settle();
    rec.stop();
    const frames = rec.frames();

    expect(frames.some((f) => f.noAccess)).toBe(false);
    const first = frames.findIndex((f) => f.cards > 0);
    expect(frames[first]).toEqual(expect.objectContaining({ placeholders: 0, newButton: true }));
    expect(duplicates(server.requests)).toEqual([]);
  });
});
