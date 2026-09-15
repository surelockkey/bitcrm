"use client";

import Link from "next/link";
import {
  Bot,
  Briefcase,
  Copy,
  Flag,
  ImageIcon,
  Mail,
  MessageSquare,
  StickyNote,
  Voicemail,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { FeedMessage } from "../api";
import { formatMessageTime, isFailedStatus } from "../lib";
import { MessageAttachments } from "./message-attachments";
import { StatusTicks } from "./status-ticks";

/** Lines that are events rather than conversation: voicemails, portal notices, system sends. */
export const isSystemNote = (m: FeedMessage): boolean =>
  m.origin === "system" || !!m.callSid || !!m.recordingUrl || m.channel === "note";

function ChannelIcon({ message }: { message: FeedMessage }) {
  if (message.channel === "email") return <Mail className="size-3" aria-label="Email" />;
  if (message.channel === "in_app") return <MessageSquare className="size-3" aria-label="In-app" />;
  if (message.channel === "note") return <StickyNote className="size-3" aria-label="Note" />;
  if (message.channel === "mms" || message.attachments?.length) {
    return <ImageIcon className="size-3" aria-label="MMS" />;
  }
  return null;
}

/**
 * A voicemail, a client-portal event, a system notice — centred in the
 * thread as a note, the way Workiz shows them, with the recording playable
 * in place and the transcript underneath.
 */
function SystemNote({ message }: { message: FeedMessage }) {
  return (
    <div className="flex w-full justify-center" data-direction="system" data-message-id={message.id}>
      <div className="max-w-[min(90%,36rem)] rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-center text-xs text-muted-foreground">
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
        {message.dealId ? (
          <Link href={`/deals/${message.dealId}`} className="mt-1 inline-flex items-center gap-1 text-brand hover:underline">
            <Briefcase className="size-3" /> Open job
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function MessageBubble({
  message,
  authorName,
  canManage,
  onToggleFlag,
  showJob = true,
}: {
  message: FeedMessage;
  /** The teammate who sent it, when known. */
  authorName?: string;
  canManage: boolean;
  onToggleFlag?: (message: FeedMessage) => void;
  /** Off inside a job's own tab, where every line is about that job. */
  showJob?: boolean;
}) {
  if (isSystemNote(message)) return <SystemNote message={message} />;

  const outbound = message.direction === "outbound";
  const failed = isFailedStatus(message.status);
  const body = message.body ?? (message.attachments?.length ? "" : "(empty)");

  const copy = () => {
    if (!message.body) return;
    void navigator.clipboard?.writeText(message.body).then(
      () => toast.success("Copied"),
      () => toast.error("Could not copy"),
    );
  };

  const byline = outbound
    ? message.origin === "automation"
      ? "Automation"
      : authorName ?? message.sentByName
    : undefined;

  return (
    <div
      className={cn("group/msg flex w-full flex-col gap-1", outbound ? "items-end" : "items-start")}
      data-direction={message.direction}
      data-message-id={message.id}
    >
      <div
        className={cn(
          "relative max-w-[min(85%,36rem)] rounded-2xl px-3.5 py-2 text-sm shadow-xs",
          outbound
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground",
          failed && "ring-1 ring-destructive/60",
        )}
      >
        {message.subject ? (
          <div className={cn("mb-1 text-xs font-semibold", outbound ? "opacity-90" : "text-muted-foreground")}>
            {message.subject}
          </div>
        ) : null}
        {body ? <p className="whitespace-pre-wrap break-words">{body}</p> : null}
        {message.attachments?.length ? (
          <div className={cn(body && "mt-2")}>
            <MessageAttachments attachments={message.attachments} align={outbound ? "end" : "start"} />
          </div>
        ) : null}

        {/* Hover actions: flag (manage) and copy. */}
        <div
          className={cn(
            "absolute top-1 flex gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100 focus-within:opacity-100",
            outbound ? "-left-14 flex-row-reverse" : "-right-14",
          )}
        >
          {canManage && onToggleFlag ? (
            <button
              type="button"
              aria-label={message.flagged ? "Unflag message" : "Flag message"}
              aria-pressed={!!message.flagged}
              onClick={() => onToggleFlag(message)}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Flag className={cn("size-3.5", message.flagged && "fill-current text-amber-500")} />
            </button>
          ) : null}
          {message.body ? (
            <button
              type="button"
              aria-label="Copy message"
              onClick={copy}
              className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <Copy className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex max-w-[min(85%,36rem)] flex-wrap items-center gap-x-1.5 gap-y-0.5 px-1 text-[11px] text-muted-foreground",
          outbound && "justify-end",
        )}
      >
        <ChannelIcon message={message} />
        {message.flagged ? <Flag className="size-3 fill-current text-amber-500" aria-label="Flagged" /> : null}
        <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
        {byline ? (
          <span className="inline-flex items-center gap-1">
            {message.origin === "automation" ? <Bot className="size-3" /> : null}· {byline}
          </span>
        ) : null}
        {showJob && message.dealId ? (
          <Link
            href={`/deals/${message.dealId}`}
            className="inline-flex items-center gap-0.5 rounded-full border px-1.5 py-px hover:bg-accent"
          >
            <Briefcase className="size-2.5" /> Job
          </Link>
        ) : null}
        {outbound ? (
          <StatusTicks
            status={message.status}
            errorCode={message.errorCode}
            errorMessage={message.errorMessage}
          />
        ) : null}
      </div>

      {failed ? (
        <p className={cn("max-w-[min(85%,36rem)] px-1 text-[11px] text-destructive", outbound && "text-right")}>
          {message.errorMessage ?? `Not delivered${message.errorCode ? ` (error ${message.errorCode})` : ""}`}
        </p>
      ) : null}
    </div>
  );
}
