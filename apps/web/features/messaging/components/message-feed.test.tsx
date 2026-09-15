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
    expect(screen.getByText("Failed · Unreachable destination handset")).toBeInTheDocument();
  });

  it("spells out a known code, else the code itself, else plain 'Not delivered'", () => {
    const failed = (id: string, extra: Partial<FeedMessage>) =>
      msg(id, today(11), { direction: "outbound", origin: "user", status: "failed", ...extra });
    renderFeed({
      messages: [
        failed("geo", { errorCode: "21408" }),
        failed("stop", { errorCode: "21610" }),
        failed("dlc", { errorCode: "30034" }),
        failed("odd", { errorCode: "12345" }),
        failed("bare", {}),
      ],
    });

    expect(bubbleOf("body geo")).toHaveTextContent("Failed · Texting this country is not enabled on the account");
    expect(bubbleOf("body stop")).toHaveTextContent("Failed · This number opted out of texts (STOP)");
    expect(bubbleOf("body dlc")).toHaveTextContent("Failed · Sender number is not registered for A2P 10DLC");
    expect(bubbleOf("body odd")).toHaveTextContent("Failed · Not delivered (code 12345)");
    expect(bubbleOf("body bare")).toHaveTextContent("Failed · Not delivered");
    // The alert mark replaces the ticks on every failed line.
    expect(screen.getAllByRole("img")).toHaveLength(5);
    for (const icon of screen.getAllByRole("img")) expect(icon).toHaveAttribute("data-tick", "error");
  });

  it("offers Resend only on a failed outbound line, and only when the viewer may send", async () => {
    const onResend = vi.fn();
    const { rerender } = renderFeed({
      messages: [
        msg("bad", today(11), { direction: "outbound", origin: "user", status: "failed", errorCode: "30007" }),
        msg("ok", today(10), { direction: "outbound", origin: "user", status: "delivered" }),
        msg("in", today(9)),
      ],
      onResend,
    });

    const buttons = screen.getAllByRole("button", { name: "Resend" });
    expect(buttons).toHaveLength(1);
    expect(bubbleOf("body bad")).toContainElement(buttons[0]);
    expect(within(bubbleOf("body ok")).queryByRole("button", { name: "Resend" })).toBeNull();
    expect(within(bubbleOf("body in")).queryByRole("button", { name: "Resend" })).toBeNull();

    await userEvent.click(buttons[0]);
    expect(onResend).toHaveBeenCalledWith(expect.objectContaining({ id: "bad" }));

    // Without `messages.send` the thread passes no handler: the reason stays, the button goes.
    rerender(
      <TooltipProvider>
        <MessageFeed
          messages={[msg("bad", today(11), { direction: "outbound", origin: "user", status: "failed", errorCode: "30007" })]}
          canManage={false}
        />
      </TooltipProvider>,
    );
    expect(screen.getByText("Failed · Filtered by the carrier as spam")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
  });

  it("says 'Resent' instead of offering Resend once the line was resent, and waits while one is in flight", () => {
    const { rerender } = renderFeed({
      messages: [
        msg("orig", today(11), {
          direction: "outbound",
          origin: "user",
          status: "failed",
          errorCode: "21408",
          resentAsMessageId: "copy",
        }),
        msg("copy", today(12), { direction: "outbound", origin: "user", status: "queued", resentFromMessageId: "orig" }),
      ],
      onResend: vi.fn(),
    });

    expect(bubbleOf("body orig")).toHaveTextContent("· Resent");
    expect(screen.queryByRole("button", { name: "Resend" })).toBeNull();
    expect(bubbleOf("body copy")).toHaveTextContent("Sending…");

    rerender(
      <TooltipProvider>
        <MessageFeed
          messages={[msg("orig", today(11), { direction: "outbound", origin: "user", status: "failed" })]}
          canManage={false}
          onResend={vi.fn()}
          resendingMessageIds={new Set(["orig"])}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Resending…" })).toBeDisabled();
  });

  it("shows a spinner with 'Sending…', then one tick for sent and two for delivered", () => {
    renderFeed({
      messages: [
        msg("q", today(12), { direction: "outbound", origin: "user", status: "queued" }),
        msg("s", today(11), { direction: "outbound", origin: "user", status: "sending" }),
        msg("t", today(10), { direction: "outbound", origin: "user", status: "sent" }),
        msg("d", today(9), { direction: "outbound", origin: "user", status: "delivered" }),
      ],
    });

    expect(within(bubbleOf("body q")).getByRole("img", { name: "Queued" })).toHaveAttribute("data-tick", "pending");
    expect(bubbleOf("body q")).toHaveTextContent("Sending…");
    const sending = within(bubbleOf("body s")).getByRole("img", { name: "Sending" });
    expect(sending).toHaveAttribute("data-tick", "pending");
    expect(sending.querySelector("svg")).toHaveClass("animate-spin");
    expect(within(bubbleOf("body t")).getByRole("img", { name: "Sent" })).toHaveAttribute("data-tick", "sent");
    expect(bubbleOf("body t")).toHaveTextContent("Message sent");
    expect(within(bubbleOf("body d")).getByRole("img", { name: "Delivered" })).toHaveAttribute("data-tick", "delivered");
    expect(bubbleOf("body d")).toHaveTextContent("Message received");
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
