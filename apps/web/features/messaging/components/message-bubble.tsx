"use client";

import Link from "next/link";
import type { ComponentProps } from "react";
import { BadgeDollarSign, Bot, Eye, Pencil, PenLine, Voicemail, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import type { FeedMessage } from "../api";
import { channelLabel, formatMessageStamp, formatMessageTime, isFailedStatus, statusText } from "../lib";
import { MessageAttachments } from "./message-attachments";
import { estimateHref, invoiceHref } from "@/features/billing/components/client-documents";
import { WzCopyIcon, WzForwardIcon, WzStarIcon } from "./inbox-icons";
import { StatusTicks } from "./status-ticks";

/** Lines that are events rather than conversation: voicemails, portal notices, system sends. */
export const isSystemNote = (m: FeedMessage): boolean =>
  m.origin === "system" || !!m.callSid || !!m.recordingUrl || m.channel === "note";

/** Workiz keeps every bubble at 60% of the thread's width, however short the text. */
const BUBBLE_WIDTH = "w-[60%] max-md:w-[88%]";

/** The yellow "✎ Edit Job" of a dispatcher's job message: Workiz's primary regular pill, straight to the job. */
function EditJobButton({ dealId }: { dealId: string }) {
  return (
    <Button asChild className="mt-4 gap-0 px-3 text-wz-strong!">
      <Link href={`/deals/${dealId}`}>
        <Pencil className="size-[15px]" strokeWidth={1.5} />
        <span className="px-1">Edit Job</span>
      </Link>
    </Button>
  );
}

/**
 * "Oct 08 2026 11:15 PM Text" — the stamp, the channel word dotted-underlined
 * as Workiz does; an automation's adds " | AUTOMATED NOTIFICATION".
 */
function Stamp({ message }: { message: FeedMessage }) {
  const channel = channelLabel(message.channel);
  return (
    <span className="whitespace-nowrap">
      <time dateTime={message.createdAt}>{formatMessageStamp(message.createdAt)}</time>{" "}
      <strong className="border-b border-dotted border-current font-medium" title={`Sent as ${channel.toLowerCase()}`}>
        {channel}
      </strong>
      {message.origin === "automation" ? " | AUTOMATED NOTIFICATION" : null}
    </span>
  );
}

function IconButton({ className, ...props }: ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn("grid h-5 place-items-center transition-opacity hover:opacity-70", className)}
      {...props}
    />
  );
}

const PORTAL_ICON = { viewed: Eye, signed: PenLine, declined: XCircle, payment: BadgeDollarSign } as const;

/**
 * What the client did on the portal, written by the system (Workiz puts
 * these in the thread: "Viewed estimate #…", "… signed Invoice #…", "…
 * submitted payment for invoice #…"): one centred line with its time and the
 * document a click away — drawn as Workiz draws the day chip (white, #e3e3e3,
 * r70, 12px/16px), not a bubble, and no Edit Job.
 */
function PortalLine({ message }: { message: FeedMessage }) {
  const kind = message.portalEvent!;
  const Icon = PORTAL_ICON[kind] ?? Bot;
  const docKind = message.entityType === "estimate" ? "estimate" : "invoice";
  const href =
    message.entityId && docKind === "estimate"
      ? estimateHref({ id: message.entityId })
      : message.entityId
        ? invoiceHref({ id: message.entityId, dealId: message.dealId })
        : null;
  return (
    <div className="my-[12.5px] flex w-full justify-center px-5" data-direction="system" data-portal-event={kind} data-message-id={message.id}>
      <div className="inline-flex max-w-[min(90%,36rem)] flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-[70px] border border-[#e3e3e3] bg-background px-[11px] py-1 text-[12px] leading-4 text-wz-strong">
        <Icon className="size-3.5 flex-none" aria-hidden strokeWidth={1.5} />
        <span className="font-semibold">{message.subject}</span>
        <time dateTime={message.createdAt} className="text-wz-text">
          {formatMessageTime(message.createdAt)}
        </time>
        {href ? (
          <Link href={href} className="font-semibold text-wz-link hover:underline">
            Open {docKind}
          </Link>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A voicemail, a system notice — centred in the thread as a note on white
 * (1px #e3e3e3, r8, 12px/16px), the recording playable in place and the
 * transcript underneath.
 */
function SystemNote({ message, showJob }: { message: FeedMessage; showJob: boolean }) {
  return (
    <div className="my-[12.5px] flex w-full justify-center px-5" data-direction="system" data-message-id={message.id}>
      <div className="max-w-[min(90%,36rem)] rounded-[8px] border border-[#e3e3e3] bg-background px-4 py-3 text-center text-[12px] leading-4 text-wz-text">
        <div className="flex items-center justify-center gap-1.5 font-semibold text-foreground">
          {message.recordingUrl || message.callSid ? (
            <Voicemail className="size-3.5" strokeWidth={1.5} />
          ) : (
            <Bot className="size-3.5" strokeWidth={1.5} />
          )}
          {message.subject ?? (message.recordingUrl ? "Voicemail" : "System message")}
          <span className="font-normal text-wz-text">· {formatMessageTime(message.createdAt)}</span>
        </div>
        {message.recordingUrl ? (
          <audio controls preload="none" src={message.recordingUrl} className="mx-auto mt-2 h-8 w-full max-w-xs" />
        ) : null}
        {message.body ? (
          <p className="mt-2 whitespace-pre-wrap break-words text-left text-[14px] leading-[1.3em] text-foreground">
            {message.body}
          </p>
        ) : null}
        {message.attachments?.length ? (
          <div className="mt-2">
            <MessageAttachments attachments={message.attachments} />
          </div>
        ) : null}
        {showJob && message.dealId ? <EditJobButton dealId={message.dealId} /> : null}
      </div>
    </div>
  );
}

/**
 * One line of the thread, drawn as Workiz draws it (`ms_msg_container` /
 * `ms_message`, pg_messages_wz_07_* and the stylesheet): 60% of the pane,
 * 12.5px above and below, 20px from the left and 25px from the right; a 25px
 * padded bubble rounded 25px except the speaker's corner, 14px/18.2px.
 * Outgoing is ink with white words on the right, incoming white with ink on
 * the left. On top, the sender in semibold (none on an automation) and the
 * forward / copy / star glyphs; the text 10px under. Image attachments are
 * Workiz's 100×85 framed tiles; a job message carries the yellow "Edit Job".
 * Under the bubble, 10px #666: outgoing has the tick and "Message received"
 * on the left and the stamp on the right, incoming the stamp alone. A line
 * that did not arrive reads "Failed · <why>" in #f45e44 with Resend (ours);
 * once resent it says so instead.
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
  if (message.portalEvent) return <PortalLine message={message} />;
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

  // Workiz names the sender on every line but an automation's.
  const name = outbound
    ? message.origin === "automation"
      ? undefined
      : (authorName ?? message.sentByName ?? "You")
    : partyName || (message.from && !message.fromMasked ? formatPhone(message.from) : undefined);

  return (
    <div
      className={cn(
        "group/msg relative ml-5 mr-[25px] my-[12.5px] break-words",
        BUBBLE_WIDTH,
        outbound ? "self-end" : "self-start",
      )}
      data-direction={message.direction}
      data-message-id={message.id}
    >
      <div
        className={cn(
          "mb-2 rounded-[25px] p-[25px] text-[14px] leading-[1.3em]",
          outbound
            ? "rounded-br-none bg-foreground text-white [&_a]:text-white"
            : "rounded-bl-none bg-background text-foreground",
          failed && "ring-1 ring-wz-danger",
        )}
      >
        <div className="flex items-start justify-between font-semibold capitalize">
          <div className="mr-2 min-w-0 flex-1 truncate">{name}</div>
          <div className="flex shrink-0 items-start gap-4">
            {onForward ? (
              <IconButton aria-label="Forward message" title="Forward" onClick={() => onForward(message)}>
                <WzForwardIcon />
              </IconButton>
            ) : null}
            {message.body ? (
              <IconButton aria-label="Copy message" title="Copy" onClick={copy}>
                <WzCopyIcon />
              </IconButton>
            ) : null}
            {canManage && onToggleFlag ? (
              <IconButton
                aria-label={message.flagged ? "Unstar message" : "Star message"}
                aria-pressed={!!message.flagged}
                title="Star message"
                onClick={() => onToggleFlag(message)}
              >
                <WzStarIcon tone={outbound ? "outgoing" : "incoming"} starred={!!message.flagged} />
              </IconButton>
            ) : null}
          </div>
        </div>

        {message.subject ? <div className="mt-2.5 font-semibold">{message.subject}</div> : null}
        {body ? <p className="mt-2.5 whitespace-pre-wrap">{body}</p> : null}
        {message.attachments?.length ? (
          <div className={cn(body ? "mt-[18px]" : "mt-2.5")}>
            <MessageAttachments attachments={message.attachments} thumbnails />
          </div>
        ) : null}
        {showJob && message.dealId ? <EditJobButton dealId={message.dealId} /> : null}
      </div>

      <div
        className={cn(
          "flex w-full items-center gap-4 text-[10px] leading-4 text-wz-text",
          outbound ? "justify-between" : "justify-start",
        )}
      >
        {outbound ? (
          <span
            className={cn("inline-flex min-w-0 flex-wrap items-center gap-x-[3px] gap-y-0.5", failed && "text-wz-danger")}
            data-status={message.status}
          >
            <StatusTicks status={message.status} errorCode={message.errorCode} errorMessage={message.errorMessage} />
            <span className={cn("break-words", failed && "font-medium")}>{statusText(message.status, message)}</span>
            {message.resentAsMessageId ? (
              <span className="text-wz-text" data-testid="resent-note">
                · Resent
              </span>
            ) : failed && onResend ? (
              <button
                type="button"
                disabled={resending}
                onClick={() => onResend(message)}
                className="ml-1 font-semibold underline underline-offset-2 hover:opacity-80 disabled:cursor-default disabled:opacity-60"
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
