import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { http, HttpResponse, delay } from "msw";
import type { AutomationRun } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { AutomationActivityPage, sinceInstant } from "./automation-activity-page";

const search = vi.hoisted(() => ({ value: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search.value),
  usePathname: () => "/automations/activity",
}));

const permissions = vi.hoisted(() => ({
  value: { can: (_r: string, _a: string): boolean => true },
}));
vi.mock("@/features/auth/use-permissions", () => ({
  usePermissions: () => ({ ...permissions.value, isLoading: false, me: { id: "me" } }),
}));

const rules = [
  { id: "rule-1", name: "Canceled job & techs", enabled: true, createdAt: "", updatedAt: "" },
  { id: "rule-2", name: "On my way", enabled: true, createdAt: "", updatedAt: "" },
];

/** A rule deleted since it fired: 30 days of its firings outlive it. */
const GONE = "gone-1";

const run = (over: Partial<AutomationRun> & Pick<AutomationRun, "id" | "ruleId">): AutomationRun => ({
  firedAt: "2026-09-16T15:04:00.000Z",
  trigger: "deal.status_changed",
  entity: "deal:d-1",
  occurrence: "o",
  outcome: "sent",
  actions: [{ type: "send_sms", to: "Ann (tech)", outcome: "sent", body: "The job was canceled." }],
  ...over,
});

const page1: AutomationRun[] = [
  run({ id: "r-1", ruleId: "rule-1" }),
  run({ id: "r-2", ruleId: "rule-2", firedAt: "2026-09-16T14:00:00.000Z" }),
  run({
    id: "r-3",
    ruleId: GONE,
    firedAt: "2026-09-16T13:00:00.000Z",
    actions: [{ type: "send_sms", to: "the client", outcome: "sent", body: "We are on the way." }],
  }),
];

let asked: URL[] = [];

/** The feed answer for this test; each case overrides it. */
let feed: (url: URL) => { items: AutomationRun[]; nextCursor?: string } = () => ({ items: page1 });

beforeEach(() => {
  asked = [];
  search.value = "";
  permissions.value = { can: () => true };
  feed = () => ({ items: page1 });
  server.use(
    // Ahead of `:id/runs`, which would otherwise swallow `/runs`.
    http.get("*/messaging/automations/runs", ({ request }) => {
      const url = new URL(request.url);
      asked.push(url);
      return HttpResponse.json({ success: true, data: feed(url) });
    }),
    http.get("*/messaging/automations", () => HttpResponse.json({ success: true, data: rules })),
  );
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AutomationActivityPage />
    </QueryClientProvider>,
  );
}

const lastAsked = () => asked[asked.length - 1];

describe("AutomationActivityPage", () => {
  it("lists every rule's firings, newest first, with what each one sent", async () => {
    renderPage();

    const rows = await screen.findByTestId("automation-activity");
    expect(within(rows).getByText("Canceled job & techs")).toBeInTheDocument();
    expect(within(rows).getByText("On my way")).toBeInTheDocument();
    expect(within(rows).getAllByText("The job was canceled.")).toHaveLength(2);
    expect(within(rows).getAllByRole("link", { name: "Open job d-1" })).toHaveLength(3);
    expect(screen.getByText("3 firings")).toBeInTheDocument();
  });

  it("gives a firing that sent nothing its reason once, not twice", async () => {
    feed = () => ({
      items: [
        run({
          id: "r-5",
          ruleId: "rule-1",
          outcome: "skipped",
          actions: [],
          reason: "the job has no technician",
        }),
      ],
    });
    renderPage();

    const row = within(await screen.findByTestId("activity-r-5"));
    expect(row.getAllByText(/the job has no technician/)).toHaveLength(1);
  });

  it("owns up to a firing whose rule has since been deleted", async () => {
    renderPage();

    const row = within(await screen.findByTestId("activity-r-3"));
    expect(row.getByText("A rule that has since been deleted")).toBeInTheDocument();
    // The firing itself is still whole: the rule is gone, what it sent is not.
    expect(row.getByText("We are on the way.")).toBeInTheDocument();
  });

  it("does not call a rule deleted while the rules are still loading", async () => {
    server.use(
      http.get("*/messaging/automations", async () => {
        await delay(60);
        return HttpResponse.json({ success: true, data: rules });
      }),
    );
    renderPage();

    const row = await screen.findByTestId("activity-r-1");
    expect(within(row).queryByText("A rule that has since been deleted")).not.toBeInTheDocument();
    expect(await screen.findByText("Canceled job & techs")).toBeInTheDocument();
  });

  it("does not call a rule deleted when it is the rule list that failed", async () => {
    server.use(
      http.get("*/messaging/automations", () =>
        HttpResponse.json(
          { success: false, error: { code: "BOOM", message: "rules are down" } },
          { status: 500 },
        ),
      ),
    );
    renderPage();

    const row = within(await screen.findByTestId("activity-r-1"));
    expect(row.queryByText("A rule that has since been deleted")).not.toBeInTheDocument();
    expect(row.getByText("Rule rule-1")).toBeInTheDocument();
    // What the firing did is read from the feed, so it survives intact.
    expect(row.getByText("The job was canceled.")).toBeInTheDocument();
  });

  it("keeps a deleted rule in the rule filter, and asks the feed for it", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("automation-activity");

    await user.click(screen.getByLabelText("Rule"));
    await user.click(await screen.findByRole("option", { name: `Deleted rule ${GONE}` }));

    await waitFor(() => expect(lastAsked().searchParams.get("ruleId")).toBe(GONE));
  });

  it("narrows by outcome", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("automation-activity");

    await user.click(screen.getByLabelText("Outcome"));
    await user.click(await screen.findByRole("option", { name: "Failed" }));

    await waitFor(() => expect(lastAsked().searchParams.get("outcome")).toBe("failed"));
  });

  it("narrows by date, as an instant the feed understands", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("automation-activity");

    await user.click(screen.getByLabelText("Date"));
    await user.click(await screen.findByRole("option", { name: "Last 7 days" }));

    await waitFor(() => expect(lastAsked().searchParams.get("since")).toBeTruthy());
    const since = new Date(lastAsked().searchParams.get("since") as string).getTime();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(Date.now() - since - sevenDays)).toBeLessThan(60_000);
  });

  it("opens on the rule the log linked it to", async () => {
    search.value = `rule=${GONE}`;
    renderPage();

    await waitFor(() => expect(lastAsked().searchParams.get("ruleId")).toBe(GONE));
    // Even with nothing in the list to name it, the filter still says what it holds.
    expect(await screen.findByLabelText("Rule")).toHaveTextContent(`Deleted rule ${GONE}`);
  });

  it("follows the cursor for the next page and keeps what is already listed", async () => {
    const user = userEvent.setup();
    feed = (url) =>
      url.searchParams.get("cursor")
        ? { items: [run({ id: "r-9", ruleId: "rule-2", firedAt: "2026-09-15T09:00:00.000Z" })] }
        : { items: page1, nextCursor: "page-2" };
    renderPage();

    await screen.findByTestId("activity-r-1");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByTestId("activity-r-9")).toBeInTheDocument();
    expect(screen.getByTestId("activity-r-1")).toBeInTheDocument();
    expect(lastAsked().searchParams.get("cursor")).toBe("page-2");
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument(),
    );
  });

  it("lists a run once when two pages overlap", async () => {
    const user = userEvent.setup();
    // What a refetch between pages does: the row at the seam arrives twice.
    feed = (url) =>
      url.searchParams.get("cursor")
        ? { items: [page1[2], run({ id: "r-9", ruleId: "rule-2" })] }
        : { items: page1, nextCursor: "page-2" };
    renderPage();

    await screen.findByTestId("activity-r-1");
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByTestId("activity-r-9")).toBeInTheDocument();
    expect(screen.getAllByTestId("activity-r-3")).toHaveLength(1);
    expect(screen.getByText("4 firings")).toBeInTheDocument();
  });

  it("an empty page with a cursor is not an empty feed", async () => {
    const user = userEvent.setup();
    feed = (url) =>
      url.searchParams.get("cursor")
        ? { items: [run({ id: "r-7", ruleId: "rule-1" })] }
        : { items: [], nextCursor: "page-2" };
    renderPage();

    expect(await screen.findByText("Nothing yet in the stretch read so far")).toBeInTheDocument();
    expect(screen.queryByText("No automation has fired yet")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Keep looking" }));
    expect(await screen.findByTestId("activity-r-7")).toBeInTheDocument();
  });

  it("says a workspace has never fired a rule, which is not the same as a failure", async () => {
    feed = () => ({ items: [] });
    renderPage();

    expect(await screen.findByText("No automation has fired yet")).toBeInTheDocument();
    expect(screen.queryByText("The activity could not be loaded")).not.toBeInTheDocument();
  });

  it("says when it is the filters that match nothing", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId("automation-activity");

    feed = () => ({ items: [] });
    await user.click(screen.getByLabelText("Outcome"));
    await user.click(await screen.findByRole("option", { name: "Failed" }));

    const empty = (await screen.findByText("No firing matches these filters"))
      .parentElement as HTMLElement;
    await user.click(within(empty).getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(lastAsked().searchParams.get("outcome")).toBeNull());
  });

  it("a request that failed says so, and can be tried again", async () => {
    const user = userEvent.setup();
    let fail = true;
    server.use(
      http.get("*/messaging/automations/runs", () => {
        if (fail) {
          fail = false;
          return HttpResponse.json(
            { success: false, error: { code: "BOOM", message: "The feed is down" } },
            { status: 500 },
          );
        }
        return HttpResponse.json({ success: true, data: { items: page1 } });
      }),
    );
    renderPage();

    expect(await screen.findByText("The activity could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("The feed is down")).toBeInTheDocument();
    expect(screen.queryByText("No automation has fired yet")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("activity-r-1")).toBeInTheDocument();
  });

  it("a reader without settings.view gets the module's No access, not a blank page", async () => {
    permissions.value = { can: () => false };
    renderPage();

    expect(await screen.findByText("No access")).toBeInTheDocument();
    expect(asked).toHaveLength(0);
  });
});

describe("sinceInstant", () => {
  const now = new Date("2026-09-16T15:04:00.000Z");

  it("has no bound at all for 'anytime'", () => {
    expect(sinceInstant("all", now)).toBeUndefined();
  });

  it("counts back in whole days", () => {
    expect(sinceInstant("24h", now)).toBe("2026-09-15T15:04:00.000Z");
    expect(sinceInstant("7d", now)).toBe("2026-09-09T15:04:00.000Z");
    expect(sinceInstant("14d", now)).toBe("2026-09-02T15:04:00.000Z");
  });

  it("starts 'today' at the reader's own midnight", () => {
    const midnight = new Date(sinceInstant("today", now) as string);
    expect(midnight.getHours()).toBe(0);
    expect(midnight.getDate()).toBe(now.getDate());
  });
});
