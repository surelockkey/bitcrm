"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { Bot, Copy, Pencil, SquarePen, Star, Voicemail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import type { FeedMessage } from "../api";
import { channelLabel, formatMessageStamp, formatMessageTime, isFailedStatus, statusText } from "../lib";
import { MessageAttachments } from "./message-attachments";
import { StatusTicks } from "./status-ticks";

/** Lines that are events rather than conversation: voicemails, portal notices, system sends. */
export const isSystemNote = (m: FeedMessage): boolean =>
  m.origin === "system" || !!m.callSid || !!m.recordingUrl || m.channel === "note";

/** Workiz keeps every bubble at 60% of the thread's width, however short the text. */
const BUBBLE_WIDTH = "w-[60%] max-md:w-[88%]";

/** The yellow "✎ Edit Job" button of a dispatcher's job message, straight to the job. */
function EditJobButton({ dealId }: { dealId: string }) {
  return (
    <Button asChild variant="brand" size="sm" className="mt-3 rounded-full px-4 font-semibold">
      <Link href={`/deals/${dealId}`}>
        <Pencil className="size-3.5" /> Edit Job
      </Link>
    </Button>
  );
}

/** "Sep 15 2026 12:10 PM  Text" — the stamp with the channel, dotted-underlined as Workiz does. */
function Stamp({ message }: { message: FeedMessage }) {
  const channel = channelLabel(message.channel);
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-[11px] text-muted-foreground">
      <time dateTime={message.createdAt}>{formatMessageStamp(message.createdAt)}</time>
      <strong className="border-b border-dotted border-current font-medium" title={`Sent as ${channel.toLowerCase()}`}>
        {channel}
      </strong>
    </span>
  );
}

function IconButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "grid size-6 place-items-center rounded-md opacity-80 transition-opacity hover:bg-white/10 hover:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

/**
 * A voicemail, a client-portal event, a system notice — centred in the
 * thread as a note, the way Workiz shows them, with the recording playable
 * in place and the transcript underneath.
 */
function SystemNote({ message, showJob }: { message: FeedMessage; showJob: boolean }) {
  return (
    <div className="flex w-full justify-center" data-direction="system" data-message-id={message.id}>
      <div className="max-w-[min(90%,36rem)] rounded-lg border border-dashed bg-background/60 px-3 py-2 text-center text-xs text-muted-foreground">
        <div className="flex items-center justify-center gap-1.5 font-medium text-foreground">
          {message.recordingUrl || message.callSid ? <Voicemail className="size-3.5" /> : <Bot className="size-3.5" />}
          {message.subject ?? (message.recordingUrl ? "Voicemail" : "System message")}
          <span className="font-normal text-muted-foreground">· {formatMessageTime(message.createdAt)}</span>
        </div>
        {message.recordingUrl ? (
          <audio controls preload="none" src={message.recordingUrl} className="mx-auto mt-1.5 h-8 w-full max-w-xs" />
        ) : null}
        {message.body ? <p className="mt-1 whitespace-pre-wrap break-words text-left">{message.body}</p> : null}
        {message.attachments?.length ? (
          <div className="mt-1.5">
            <MessageAttachments attachments={message.attachments} />
          </div>
        ) : null}
        {showJob && message.dealId ? <EditJobButton dealId={message.dealId} /> : null}
      </div>
    </div>
  );
}

/**
 * One line of the thread, drawn as Workiz draws it: outgoing messages are
 * dark rounded bubbles on the right with the sender's name in bold on top
 * and forward / copy / star at the top-right on hover; incoming ones are
 * white bubbles on the left with the client's name. Image attachments sit
 * inside as thumbnails; a job message carries the yellow "Edit Job"
 * button. Under the bubble: the delivery state on the left ("Message
 * received") and the stamp with the channel on the right. A line that did
 * not arrive reads "Failed · <why>" in red with an alert mark and a Resend
 * button; once resent it says so instead.
 */
export function MessageBubble({
  message,
  authorName,
  partyName,
  canManage,
  onToggleFlag,
  onForward,
  onResend,
  resending = false,
  showJob = true,
}: {
  message: FeedMessage;
  /** The teammate who sent it, when known. */
  authorName?: string;
  /** Who the other side is — the name on incoming bubbles. */
  partyName?: string;
  canManage: boolean;
  onToggleFlag?: (message: FeedMessage) => void;
  /** Forward the text into a new message; the icon is hidden without it. */
  onForward?: (message: FeedMessage) => void;
  /** Resend a failed line; the button is hidden without it (no `messages.send`). */
  onResend?: (message: FeedMessage) => void;
  /** This line's resend is in flight — the button waits. */
  resending?: boolean;
  /** Off inside a job's own tab, where every line is about that job. */
  showJob?: boolean;
}) {
  if (isSystemNote(message)) return <SystemNote message={message} showJob={showJob} />;

  const outbound = message.direction === "outbound";
  const failed = isFailedStatus(message.status);
  const body = message.body ?? "";

  const copy = () => {
    if (!message.body) return;
    void navigator.clipboard?.writeText(message.body).then(
      () => toast.success("Copied"),
      () => toast.error("Could not copy"),
    );
  };

  const name = outbound
    ? message.origin === "automation"
      ? "Automation"
      : (authorName ?? message.sentByName ?? "You")
    : partyName || (message.from && !message.fromMasked ? formatPhone(message.from) : undefined);

  return (
    <div
      className={cn("group/msg flex w-full flex-col", outbound ? "items-end" : "items-start")}
      data-direction={message.direction}
      data-message-id={message.id}
    >
      <div
        className={cn(
          "relative rounded-2xl px-6 py-4 text-[15px] shadow-xs",
          BUBBLE_WIDTH,
          outbound ? "bg-primary text-primary-foreground" : "bg-card text-card-foreground",
          failed && "ring-1 ring-destructive/60",
        )}
      >
        <div className="mb-2 flex items-start justify-between gap-6">
          <div className="min-w-0 truncate font-semibold capitalize">{name}</div>
          <div
            className={cn(
              "flex shrink-0 items-center gap-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover/msg:opacity-100",
              message.flagged && "opacity-100",
            )}
          >
            {onForward ? (
              <IconButton aria-label="Forward message" title="Forward" onClick={() => onForward(message)}>
                <SquarePen className="size-4" />
              </IconButton>
            ) : null}
            {message.body ? (
              <IconButton aria-label="Copy message" title="Copy" onClick={copy}>
                <Copy className="size-4" />
              </IconButton>
            ) : null}
            {canManage && onToggleFlag ? (
              <IconButton
                aria-label={message.flagged ? "Unstar message" : "Star message"}
                aria-pressed={!!message.flagged}
                title="Star message"
                onClick={() => onToggleFlag(message)}
              >
                <Star className={cn("size-4", message.flagged && "fill-current")} />
              </IconButton>
            ) : null}
          </div>
        </div>

        {message.subject ? <div className="mb-1 text-sm font-medium opacity-80">{message.subject}</div> : null}
        {body ? <p className="whitespace-pre-wrap break-words leading-relaxed">{body}</p> : null}
        {message.attachments?.length ? (
          <div className={cn(body && "mt-3")}>
            <MessageAttachments attachments={message.attachments} thumbnails />
          </div>
        ) : null}
        {showJob && message.dealId ? <EditJobButton dealId={message.dealId} /> : null}
      </div>

      <div
        className={cn(
          "mt-1.5 flex items-center gap-4 px-1 text-[11px] text-muted-foreground",
          BUBBLE_WIDTH,
          outbound ? "justify-between" : "justify-start",
        )}
      >
        {outbound ? (
          <span
            className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5", failed && "text-destructive")}
            data-status={message.status}
          >
            <StatusTicks
              status={message.status}
              errorCode={message.errorCode}
              errorMessage={message.errorMessage}
              className={cn(failed && "text-destructive")}
            />
            <span className={cn("break-words", failed && "font-medium")}>{statusText(message.status, message)}</span>
            {message.resentAsMessageId ? (
              <span className="font-normal text-muted-foreground" data-testid="resent-note">
                · Resent
              </span>
            ) : failed && onResend ? (
              <button
                type="button"
                disabled={resending}
                onClick={() => onResend(message)}
                className="font-semibold underline underline-offset-2 hover:opacity-80 disabled:cursor-default disabled:opacity-60"
              >
                {resending ? "Resending…" : "Resend"}
              </button>
            ) : null}
          </span>
        ) : null}
        <Stamp message={message} />
      </div>
    </div>
  );
}
