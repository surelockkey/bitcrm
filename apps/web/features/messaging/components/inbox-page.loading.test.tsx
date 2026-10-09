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
import type { InboxConversation } from "../api";

/**
 * The inbox does not jump.
 *
 * The category numbers came on their own beat — the counters before the
 * rows, or the rows' own "50+" after them — and each one pushed its unread
 * dot aside; the list toolbar drew its group button where "New message"
 * belonged and slid it over when the permissions arrived. And the closed
 * "New message" dialog read every company in the account (page after page)
 * on every visit, for a search box nobody had opened.
 *
 * Now the numbers, the dots and the rows land in one frame, and the toolbar
 * is drawn once, whole.
 */

/** The query string the inbox opens on (`?c=` opens a thread). */
const url = vi.hoisted(() => ({ search: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/messages",
  useSearchParams: () => new URLSearchParams(url.search),
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

const conv = (id: string, name: string, extra: Partial<InboxConversation> = {}): InboxConversation => ({
  id,
  kind: "client",
  partyKind: "none",
  addresses: { phones: [], emails: [] },
  state: "open",
  unread: false,
  unreadCount: 0,
  flagged: false,
  workizName: name,
  lastMessageAt: "2026-10-05T10:00:00.000Z",
  lastMessagePreview: `preview ${id}`,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-05T10:00:00.000Z",
  ...extra,
});

/** The thread `?c=t1` opens: a client the list has not named yet. */
const openThread = () =>
  conv("t1", "", {
    workizName: undefined,
    partyKind: "contact",
    partyId: "c1",
    addresses: { phones: ["+14045551001"], emails: [] },
  });

const routes: FakeRoute[] = [
  // The numbers first, the rows later — the order the browser saw.
  {
    match: /\/messaging\/conversations\/counters$/,
    reply: () => ({
      unreadConversations: 1,
      flaggedConversations: 0,
      unreadByKind: { client: 1 },
      totalConversations: 1234,
      totalByKind: { client: 1200, unknown: 30, team: 4 },
      archivedConversations: 2,
      totalsRecountedAt: "2026-10-01T00:00:00.000Z",
    }),
  },
  {
    match: /\/messaging\/conversations$/,
    raw: true,
    reply: () => ({
      success: true,
      data: [conv("a", "Alice Adams"), conv("b", "Bo Brown", { unread: true, unreadCount: 2 })],
      pagination: {},
    }),
    delayMs: 80,
  },
  { match: /\/crm\/companies$/, raw: true, reply: () => ({ success: true, data: [], pagination: {} }) },

  // An open thread (`?c=t1`): a client the list has not named yet.
  {
    match: /\/messaging\/conversations\/t1$/,
    reply: () => openThread(),
  },
  {
    match: /\/messaging\/conversations\/t1\/messages$/,
    raw: true,
    reply: () => ({
      success: true,
      data: [
        {
          id: "m1",
          conversationId: "t1",
          channel: "sms",
          direction: "inbound",
          body: "Hello there",
          status: "received",
          origin: "user",
          createdAt: "2026-10-05T10:00:00.000Z",
          updatedAt: "2026-10-05T10:00:00.000Z",
        },
      ],
      pagination: {},
    }),
  },
  { match: /\/messaging\/conversations\/text-lookup$/, reply: () => ({ conversation: null, optOut: null, canText: true }) },
  { match: /\/messaging\/conversations\/t1\/read$/, method: "POST", reply: () => openThread() },
  // What names the thread and fills its composer answers after the messages.
  {
    match: /\/crm\/contacts\/by-ids$/,
    method: "POST",
    reply: () => [{ id: "c1", firstName: "Jane", lastName: "Roe", phones: ["+14045551001"], emails: [], addresses: [] }],
    delayMs: 80,
  },
  {
    match: /\/messaging\/templates$/,
    reply: () => [
      {
        id: "tpl1",
        messageTemplateTitle: "On our way",
        messageTemplate: "On our way",
        channel: "sms",
        isDefault: false,
        active: true,
        createdBy: "u",
        createdAt: "x",
        updatedAt: "x",
      },
    ],
    delayMs: 80,
  },
  { match: /\/messaging\/conversations\/t1\/send-options$/, reply: () => null, status: 403 },
  { match: /\/telephony\/numbers$/, reply: () => [] },
  { match: /\/users$/, raw: true, reply: () => ({ success: true, data: [], pagination: {} }) },
];

let server: FakeServer;

const { InboxPage } = await import("./inbox-page");

const renderPage = () =>
  renderWithClient(
    <TooltipProvider>
      <InboxPage />
    </TooltipProvider>,
  );

/** Drawn and not inside anything held out of sight. */
const seen = (el: Element | null): boolean => {
  if (!el) return false;
  for (let e: Element | null = el; e; e = e.parentElement) if (e.classList.contains("invisible")) return false;
  return true;
};
const count = (cat: string) => document.querySelector(`[data-testid="category-count-${cat}"]`);
const countShown = (cat: string) => seen(count(cat)) && (count(cat)?.textContent ?? "") !== "";
const rowsUp = () => !!screen.queryByText("Alice Adams");
const toolbar = () => document.querySelector('[data-testid="list-toolbar"]');

beforeEach(() => {
  perms.isLoading = false;
  url.search = "";
  server = installFakeServer(routes);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("InboxPage — no jumping", () => {
  it("draws the rows, the category numbers and the unread dot in one frame", async () => {
    const watch = watchFirstFrame(rowsUp, () => ({
      all: countShown("all") ? count("all")!.textContent : null,
      clients: countShown("clients") ? count("clients")!.textContent : null,
      dot: seen(count("clients")?.querySelector('[data-testid="unread-dot"]') ?? null),
      newMessage: seen(screen.queryByRole("button", { name: "New message" })),
      skeletons: skeletonCount(),
    }));
    renderPage();
    await screen.findByText("Alice Adams", {}, { timeout: 3000 });
    watch.stop();

    // The column prints its numbers bare, as Workiz does ("44717").
    expect(watch.frame()).toEqual({ all: "1234", clients: "1200", dot: true, newMessage: true, skeletons: 0 });
  });

  it("never shows a category number before the rows", async () => {
    let early = false;
    const observer = new MutationObserver(() => {
      if (!rowsUp() && (countShown("all") || countShown("clients"))) early = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    renderPage();
    await screen.findByText("Alice Adams", {}, { timeout: 3000 });
    observer.disconnect();

    expect(early).toBe(false);
  });

  it("keeps the list toolbar out of sight until it knows which buttons it has", async () => {
    perms.isLoading = true;
    renderPage();
    await settle(30);

    expect(toolbar()).not.toBeNull();
    expect(seen(toolbar())).toBe(false);
  });

  it("asks for each thing once, and nothing for the closed New message dialog", async () => {
    renderPage();
    await screen.findByText("Alice Adams", {}, { timeout: 3000 });
    await settle();

    expect(duplicates(server.requests)).toEqual([]);
    expect(server.requests.filter((r) => r.includes("/crm/companies"))).toEqual([]);
  });
});

/**
 * An open thread arrives whole as well. Its header skeleton was shorter than
 * the header, so the feed slid down when the header came; the header named
 * the client by number and then by name; and the quick replies landed over
 * the composer a beat after it, pushing it up into the feed.
 */
describe("InboxPage — an open thread, no jumping", () => {
  const thread = () => document.querySelector('[data-testid="conversation-thread"]');
  const threadUp = () => !!screen.queryByText("Hello there");

  it("draws the header with the client's name, the messages and the quick replies in one frame", async () => {
    url.search = "c=t1";
    const watch = watchFirstFrame(threadUp, () => ({
      title: /Jane Roe/.test(thread()?.textContent ?? ""),
      quickReplies: !!screen.queryByTestId("quick-replies"),
      skeletons: thread() ? skeletonCount(thread()!) : -1,
    }));
    renderPage();
    await screen.findByText("Hello there", {}, { timeout: 3000 });
    watch.stop();

    expect(watch.frame()).toEqual({ title: true, quickReplies: true, skeletons: 0 });
  });

  it("holds the header's room while it loads", async () => {
    url.search = "c=t1";
    renderPage();
    await settle(5);

    // The skeleton is the header's own 58px box (Workiz's bar), so nothing slides.
    const header = thread()?.firstElementChild;
    expect(header?.className).toMatch(/h-\[58px\]/);
  });
});
