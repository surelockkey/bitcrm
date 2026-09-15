import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { FeedMessage } from "../api";
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

describe("MessageFeed", () => {
  it("groups by day with separators and reads downwards, newest last", () => {
    renderFeed({
      messages: [
        msg("m3", today(10), { direction: "outbound", status: "delivered", origin: "user" }),
        msg("m2", today(9)),
        msg("m1", yesterday(15)),
      ],
    });

    const feed = screen.getByTestId("message-feed");
    const text = feed.textContent ?? "";
    expect(text.indexOf("Yesterday")).toBeLessThan(text.indexOf("Today"));
    expect(text.indexOf("body m1")).toBeLessThan(text.indexOf("body m2"));
    expect(text.indexOf("body m2")).toBeLessThan(text.indexOf("body m3"));
  });

  it("shows delivery ticks on outbound lines and the carrier's reason on failures", () => {
    renderFeed({
      messages: [
        msg("bad", today(11), {
          direction: "outbound",
          origin: "user",
          status: "undelivered",
          errorCode: "30003",
          errorMessage: "Unreachable destination handset",
        }),
        msg("ok", today(10), { direction: "outbound", origin: "user", status: "delivered" }),
        msg("in", today(9)),
      ],
    });

    expect(screen.getByRole("img", { name: "Delivered" })).toHaveAttribute("data-tick", "delivered");
    expect(screen.getByRole("img", { name: /Undelivered · Unreachable/ })).toHaveAttribute("data-tick", "error");
    expect(screen.getByText("Unreachable destination handset")).toBeInTheDocument();
    // Inbound lines carry no tick.
    const inbound = screen.getByText("body in").closest("[data-direction]")!;
    expect(within(inbound as HTMLElement).queryByRole("img")).toBeNull();
  });

  it("renders image attachments inline and other files as links", () => {
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

    expect(screen.getByRole("img", { name: "door.jpg" })).toHaveAttribute("src", "https://x/door.jpg");
    expect(screen.getByRole("link", { name: /invoice\.pdf/ })).toHaveAttribute("href", "https://x/i.pdf");
    // Stored media has no fetchable URL yet — a chip, not a broken link.
    expect(screen.queryByRole("link", { name: /stored\.png/ })).toBeNull();
    expect(screen.getByText("stored.png")).toBeInTheDocument();
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

  it("lets a manager flag a line", async () => {
    const onToggleFlag = vi.fn();
    renderFeed({ messages: [msg("m1", today(9))], canManage: true, onToggleFlag });
    await userEvent.click(screen.getByRole("button", { name: "Flag message" }));
    expect(onToggleFlag).toHaveBeenCalledWith(expect.objectContaining({ id: "m1" }));
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
    // Not a bubble: no delivery tick, no flag button.
    expect(screen.queryByRole("button", { name: /flag/i })).toBeNull();
  });
});
