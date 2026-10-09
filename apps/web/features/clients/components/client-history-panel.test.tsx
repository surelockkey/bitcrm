import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { TimelineEventType } from "@bitcrm/types";
import type { TimelineEntry } from "@bitcrm/types";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/render-with-client";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/features/deals/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/deals/hooks")>();
  return {
    ...actual,
    useUserMap: () => ({ map: new Map([["u-piper", { id: "u-piper", firstName: "Piper", lastName: "Platinum" }]]), users: [], isLoading: false }),
  };
});
vi.mock("@/features/clients/hooks", () => ({ useContactsByIds: () => ({ map: new Map(), isLoading: false }) }));
vi.mock("@/features/job-statuses/hooks", () => ({ useJobStatuses: () => ({ data: [] }) }));
vi.mock("@/features/job-types/hooks", () => ({ useJobTypes: () => ({ data: [] }) }));
vi.mock("@/features/job-sources/hooks", () => ({ useJobSources: () => ({ data: [] }) }));
vi.mock("@/features/external-companies/hooks", () => ({ useExternalCompanies: () => ({ data: [] }) }));
vi.mock("@/features/job-tags/hooks", () => ({ useJobTags: () => ({ data: [] }) }));

import { ClientHistoryPanel } from "./client-history-panel";

type Row = TimelineEntry & { dealNumber?: string };

const entry = (over: Partial<Row>): Row => ({
  id: "e1",
  dealId: "d1",
  dealNumber: "NU8GUR",
  eventType: TimelineEventType.FIELD_UPDATED,
  actorId: "u-piper",
  actorName: "piper@slk.com",
  timestamp: "2026-09-30T19:55:00.000Z",
  details: { field: "priority", oldValue: "normal", newValue: "urgent" },
  ...over,
});

const PAGE_1: Row[] = [
  entry({ id: "h1" }),
  entry({ id: "h2", eventType: TimelineEventType.NOTE_ADDED, details: {}, note: "scheduled 10-12pm", timestamp: "2026-09-30T19:53:00.000Z" }),
  entry({
    id: "h3",
    eventType: TimelineEventType.CALL_LINKED,
    details: { direction: "inbound", from: "+14753296229", durationSeconds: 77 },
    timestamp: "2026-09-30T19:50:00.000Z",
    actorId: "u-nobody",
    actorName: "Max K.",
  }),
  entry({ id: "h4", dealId: "d2", dealNumber: "SWD42X", eventType: TimelineEventType.STATUS_CHANGED, details: { fromStatus: "submitted", toStatus: "done" }, timestamp: "2026-09-30T18:44:00.000Z" }),
];

describe("ClientHistoryPanel — Workiz's History rail", () => {
  const urls: string[] = [];

  beforeEach(() => {
    urls.length = 0;
    server.use(
      http.get("*/deals/timeline/by-contact/c1", ({ request }) => {
        const url = new URL(request.url);
        urls.push(url.pathname.slice(url.pathname.indexOf("/deals/")) + url.search);
        if (url.searchParams.get("cursor") === "page-2") {
          return HttpResponse.json({
            success: true,
            data: [entry({ id: "h5", eventType: TimelineEventType.NOTE_ADDED, details: {}, note: "checked out 5:30 IL time", timestamp: "2026-09-29T10:00:00.000Z" })],
            pagination: { count: 1 },
          });
        }
        return HttpResponse.json({ success: true, data: PAGE_1, pagination: { count: PAGE_1.length, nextCursor: "page-2" } });
      }),
    );
  });

  const renderPanel = async () => {
    const r = renderWithClient(<ClientHistoryPanel contactId="c1" open onOpenChange={vi.fn()} />);
    const dialog = await screen.findByRole("complementary", { name: "History" });
    await within(dialog).findByText(/scheduled 10-12pm/);
    return { ...r, dialog };
  };

  it("shows the client's feed across jobs, each row naming its job as a link, with the actor resolved by id", async () => {
    const { dialog } = await renderPanel();
    expect(urls).toEqual(["/deals/timeline/by-contact/c1?limit=30"]);
    const rows = within(dialog).getAllByRole("listitem");
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent("Field updated");
    expect(rows[0]).toHaveTextContent("Priority: Normal → Urgent");
    expect(within(rows[0]).getByRole("link", { name: "NU8GUR" })).toHaveAttribute("href", "/deals/d1");
    expect(rows[0]).toHaveTextContent("Piper Platinum");
    expect(rows[1]).toHaveTextContent("Note");
    expect(rows[2]).toHaveTextContent("Call linked");
    expect(rows[2]).toHaveTextContent("Max K.");
    expect(within(rows[3]).getByRole("link", { name: "SWD42X" })).toHaveAttribute("href", "/deals/d2");
    // The client's history is read here, edited on the job.
    expect(within(dialog).queryByRole("button", { name: "Edit note" })).toBeNull();
    expect(within(dialog).queryByRole("textbox", { name: /Add a note/ })).toBeNull();
  });

  it("has Workiz's Filters select — All, Notes, Activities, Calls — and a search", async () => {
    const { dialog } = await renderPanel();
    await userEvent.click(within(dialog).getByRole("combobox", { name: "Filters" }));
    expect((await screen.findAllByRole("option")).map((o) => o.textContent)).toEqual(["All", "Notes", "Activities", "Calls"]);
    await userEvent.click(screen.getByRole("option", { name: "Calls" }));
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect(within(dialog).getByRole("listitem")).toHaveTextContent("Call linked");

    await userEvent.click(within(dialog).getByRole("combobox", { name: "Filters" }));
    await userEvent.click(await screen.findByRole("option", { name: "All" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Search history" }), "10-12");
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect(within(dialog).getByRole("listitem")).toHaveTextContent("scheduled 10-12pm");
  });

  it("loads the next page by cursor", async () => {
    const { dialog } = await renderPanel();
    await userEvent.click(within(dialog).getByRole("button", { name: "Load more" }));
    expect(await within(dialog).findByText(/checked out 5:30 IL time/)).toBeInTheDocument();
    expect(urls).toEqual(["/deals/timeline/by-contact/c1?limit=30", "/deals/timeline/by-contact/c1?limit=30&cursor=page-2"]);
    expect(within(dialog).queryByRole("button", { name: "Load more" })).toBeNull();
  });
});
