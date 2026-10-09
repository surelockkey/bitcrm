import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * The Automation Center does not jump.
 *
 * It said "No access" until the permissions came; then drew "0 of 0 rules
 * are on", "My automations · 0" and "0 rules" over a skeleton, and changed
 * every one of those numbers when the rules landed; and a rule's sentence was
 * written with the raw ids first and the catalog's names a beat later, which
 * re-wraps the card and moves every card below it.
 *
 * Now the numbers, the tabs and the cards land in one frame, sentences named.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/automations",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
const perms = vi.hoisted(() => ({ isLoading: false }));
vi.mock("@/features/auth/use-permissions", () => ({
  useDenied: () => () => false,
  usePermissions: () => ({
    can: () => !perms.isLoading,
    isTechnician: false,
    isLoading: perms.isLoading,
    me: perms.isLoading ? undefined : { id: "me" },
  }),
}));

const TAG_ID = "tag-1";

const rules = [
  {
    id: "scheduled",
    name: "Scheduled jobs",
    enabled: true,
    runnable: true,
    spec: {
      version: 1,
      trigger: { kind: "deal.updated" },
      conditions: [{ field: "tag", op: "in", values: [TAG_ID] }],
      actions: [{ type: "send_sms", to: "assigned_techs", body: "New scheduled job" }],
    },
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:00:00.000Z",
  },
  {
    id: "other",
    name: "Another rule",
    enabled: false,
    runnable: true,
    spec: {
      version: 1,
      trigger: { kind: "deal.updated" },
      actions: [{ type: "send_sms", to: "assigned_techs", body: "Hello" }],
    },
    createdAt: "2026-09-15T10:00:00.000Z",
    updatedAt: "2026-09-15T10:00:00.000Z",
  },
];

const routes: FakeRoute[] = [
  { match: /\/messaging\/automations$/, reply: () => rules },
  // The catalog that names the tag in the sentence answers after the rules.
  { match: /\/deals\/job-tags$/, reply: () => [{ id: TAG_ID, name: "SCHEDULED", color: "blue", priority: 1, active: true }], delayMs: 300 },
  { match: /\/deals\/job-types$/, reply: () => [] },
  { match: /\/deals\/job-sources$/, reply: () => [] },
  { match: /\/deals\/job-statuses$/, reply: () => [] },
];

let server: FakeServer;

const { AutomationsPage } = await import("./automations-page");

const renderPage = () =>
  renderWithClient(
    <TooltipProvider>
      <AutomationsPage />
    </TooltipProvider>,
  );

/** Drawn and not inside anything held out of sight. */
const seen = (el: Element | null): boolean => {
  if (!el) return false;
  for (let e: Element | null = el; e; e = e.parentElement) if (e.classList.contains("invisible")) return false;
  return true;
};
const cardsUp = () => !!screen.queryByText("Scheduled jobs");
const numbersShown = () =>
  seen(screen.queryByRole("button", { name: /^All \d+$/ })) ||
  seen(screen.queryByText("Automations triggered")) ||
  seen(screen.queryByRole("tab", { name: "My Automations" }));
/** A sentence is drawn in parts (its slots underlined): found by the whole text of its paragraph. */
const sentenceShown = (pattern: RegExp) =>
  !!screen.queryByText((_, el) => el?.tagName === "P" && pattern.test(el.textContent ?? ""));

beforeEach(() => {
  perms.isLoading = false;
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AutomationsPage — no jumping", () => {
  it("draws the numbers, the tabs and the named sentences in one frame", async () => {
    const watch = watchFirstFrame(cardsUp, () => ({
      sentence: sentenceShown(/its job tag is SCHEDULED/),
      summary: seen(screen.queryByRole("button", { name: "Active 1" })),
      tab: seen(screen.queryByRole("tab", { name: "My Automations" })),
      skeletons: skeletonCount(),
    }));
    const t0 = Date.now();
    renderPage();
    await screen.findByText("Scheduled jobs", {}, { timeout: 3000 });
    watch.stop();
    console.log("DBG", Date.now() - t0, JSON.stringify(server.requests));

    expect(watch.frame()).toEqual({ sentence: true, summary: true, tab: true, skeletons: 0 });
  });

  it("never shows a number before the rules it counts", async () => {
    let early = false;
    const observer = new MutationObserver(() => {
      if (!cardsUp() && numbersShown()) early = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    renderPage();
    await screen.findByText("Scheduled jobs", {}, { timeout: 3000 });
    observer.disconnect();

    expect(early).toBe(false);
  });

  it("waits for the permissions instead of saying No access", async () => {
    perms.isLoading = true;
    renderPage();
    await settle(30);

    expect(screen.queryByText("No access")).not.toBeInTheDocument();
    expect(skeletonCount()).toBeGreaterThan(0);
  });

  it("asks for each thing once", async () => {
    renderPage();
    await screen.findByText("Scheduled jobs", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
  });
});
