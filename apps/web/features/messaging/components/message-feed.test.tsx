import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FeedMessage } from "../api";
import { formatDayChip } from "../lib";
import { MessageFeed } from "./message-feed";

const msg = (id: string, createdAt: string, extra: Partial<FeedMessage> = {}): FeedMessage => ({
  id,
  conversationId: "c1",
  channel: "sms",
  direction: "inbound",
  body: `body ${id}`,
  status: "received",
  origin: "contact",
  createdAt,
  updatedAt: createdAt,
  ...extra,
});

const today = (h: number) => new Date(new Date().setHours(h, 0, 0, 0)).toISOString();
const yesterday = (h: number) => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

function renderFeed(props: Partial<React.ComponentProps<typeof MessageFeed>> = {}) {
  return render(
    <TooltipProvider>
      <MessageFeed messages={[]} canManage={false} {...props} />
    </TooltipProvider>,
  );
}

const bubbleOf = (text: string) => screen.getByText(text).closest("[data-direction]") as HTMLElement;

describe("MessageFeed", () => {
  it("groups by day with Workiz day chips and reads downwards, newest last", () => {
    renderFeed({
      messages: [
        msg("m3", today(10), { direction: "outbound", status: "delivered", origin: "user" }),
        msg("m2", today(9)),
        msg("m1", yesterday(15)),
      ],
    });

    const feed = screen.getByTestId("message-feed");
    const text = feed.textContent ?? "";
    const chipYesterday = formatDayChip(yesterday(15));
    const chipToday = formatDayChip(today(9));
    expect(screen.getByText(chipYesterday)).toBeInTheDocument();
    expect(text.indexOf(chipYesterday)).toBeLessThan(text.indexOf(chipToday));
    expect(text.indexOf("body m1")).toBeLessThan(text.indexOf("body m2"));
    expect(text.indexOf("body m2")).toBeLessThan(text.indexOf("body m3"));
  });

  it("draws outgoing lines with the sender on top and 'Message received' plus the stamp underneath", () => {
    renderFeed({
      messages: [
        msg("out", today(10), { direction: "outbound", origin: "user", status: "delivered", sentByUserId: "u1", sentByName: "Melanie" }),
        msg("in", today(9)),
      ],
      authorNames: new Map([["u1", "Melanie Dispatcher"]]),
      partyName: "Jody Foulks",
    });

    const out = bubbleOf("body out");
    expect(out).toHaveAttribute("data-direction", "outbound");
    expect(within(out).getByText("Melanie Dispatcher")).toBeInTheDocument();
    expect(within(out).getByText("Message received")).toBeInTheDocument();
    expect(within(out).getByText("Text")).toBeInTheDocument();
    expect(within(out).getByRole("img", { name: "Delivered" })).toHaveAttribute("data-tick", "delivered");

    // Incoming: the client's name on top, the stamp, no delivery state.
    const inn = bubbleOf("body in");
    expect(within(inn).getByText("Jody Foulks")).toBeInTheDocument();
    expect(within(inn).queryByText(/Message received/)).toBeNull();
    expect(within(inn).queryByRole("img")).toBeNull();
    expect(within(inn).getByText("Text")).toBeInTheDocument();
  });

  it("shows the carrier's reason on failures", () => {
    renderFeed({
      messages: [
        msg("bad", today(11), {
          direction: "outbound",
          origin: "user",
          status: "undelivered",
          errorCode: "30003",
          errorMessage: "Unreachable destination handset",
        }),
      ],
    });

    expect(screen.getByRole("img", { name: /Undelivered · Unreachable/ })).toHaveAttribute("data-tick", "error");
    expect(screen.getByText("Not delivered")).toBeInTheDocument();
    expect(screen.getByText("Unreachable destination handset")).toBeInTheDocument();
  });

  it("renders image attachments as thumbnails inside the bubble and other files as links", () => {
    renderFeed({
      messages: [
        msg("a", today(9), {
          attachments: [
            { id: "i", fileName: "door.jpg", contentType: "image/jpeg", status: "deferred", sourceUrl: "https://x/door.jpg" },
            { id: "p", fileName: "invoice.pdf", contentType: "application/pdf", status: "deferred", sourceUrl: "https://x/i.pdf", size: 2048 },
            { id: "s", fileName: "stored.png", contentType: "image/png", status: "stored", s3Key: "k" },
          ],
        }),
      ],
    });

    const img = screen.getByRole("img", { name: "door.jpg" });
    expect(img).toHaveAttribute("src", "https://x/door.jpg");
    expect(img.className).toContain("size-24");
    expect(screen.getByRole("link", { name: /invoice\.pdf/ })).toHaveAttribute("href", "https://x/i.pdf");
    // Stored media has no fetchable URL yet — a chip, not a broken link.
    expect(screen.queryByRole("link", { name: /stored\.png/ })).toBeNull();
    expect(screen.getByText("stored.png")).toBeInTheDocument();
  });

  it("puts the yellow Edit Job button on a job message, linking to the deal", () => {
    renderFeed({
      messages: [msg("job", today(9), { direction: "outbound", origin: "automation", status: "delivered", body: "New job #J977US", dealId: "d42" })],
    });
    const btn = screen.getByRole("link", { name: "Edit Job" });
    expect(btn).toHaveAttribute("href", "/deals/d42");
    expect(bubbleOf("New job #J977US")).toContainElement(btn);
    expect(screen.getByText("Automation")).toBeInTheDocument();
  });

  it("hides Edit Job inside a job's own tab", () => {
    renderFeed({ messages: [msg("job", today(9), { dealId: "d42" })], showJob: false });
    expect(screen.queryByRole("link", { name: "Edit Job" })).toBeNull();
  });

  it("offers Load older only when there is more and calls back", async () => {
    const onLoadOlder = vi.fn();
    const { rerender } = renderFeed({ messages: [msg("m1", today(9))], hasOlder: true, onLoadOlder });
    await userEvent.click(screen.getByRole("button", { name: "Load older" }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);

    rerender(
      <TooltipProvider>
        <MessageFeed messages={[msg("m1", today(9))]} canManage={false} hasOlder={false} />
      </TooltipProvider>,
    );
    expect(screen.queryByRole("button", { name: "Load older" })).toBeNull();
  });

  it("lets a manager star a line, and copy or forward it", async () => {
    const onToggleFlag = vi.fn();
    const onForward = vi.fn();
    renderFeed({ messages: [msg("m1", today(9))], canManage: true, onToggleFlag, onForward });
    await userEvent.click(screen.getByRole("button", { name: "Star message" }));
    expect(onToggleFlag).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    await userEvent.click(screen.getByRole("button", { name: "Forward message" }));
    expect(onForward).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
    expect(screen.getByRole("button", { name: "Copy message" })).toBeInTheDocument();
  });

  it("shows the recap chip at the top of an inbox thread only", () => {
    const { unmount } = renderFeed({ messages: [msg("m1", today(9))], recap: true });
    expect(screen.getByRole("button", { name: "Recap conversation" })).toBeDisabled();
    unmount();
    renderFeed({ messages: [msg("m1", today(9))] });
    expect(screen.queryByRole("button", { name: "Recap conversation" })).toBeNull();
  });

  it("shows the empty state without messages", () => {
    renderFeed({ messages: [] });
    expect(screen.getByText("No messages yet")).toBeInTheDocument();
  });

  it("renders voicemails and system notices as centred notes with the recording", () => {
    renderFeed({
      messages: [
        msg("vm", today(9), {
          origin: "system",
          subject: "New Voicemail",
          body: "Hi, calling about the lock",
          callSid: "CA1",
          recordingUrl: "https://x/rec.mp3",
        }),
      ],
    });

    const note = screen.getByText("New Voicemail").closest("[data-direction]")!;
    expect(note).toHaveAttribute("data-direction", "system");
    expect(note.querySelector("audio")).toHaveAttribute("src", "https://x/rec.mp3");
    expect(screen.getByText("Hi, calling about the lock")).toBeInTheDocument();
    // Not a bubble: no delivery tick, no star button.
    expect(screen.queryByRole("button", { name: /star/i })).toBeNull();
  });
});
