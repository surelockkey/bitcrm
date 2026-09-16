"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Loader2, MessageSquareDashed, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { FeedMessage } from "../api";
import { groupByDay } from "../lib";
import { MessageBubble } from "./message-bubble";

const NEAR_BOTTOM_PX = 120;

/**
 * The thread, newest at the bottom, on Workiz's faintly tinted ground: the
 * "✦ Recap conversation" chip top-left, a centred day chip per day
 * ("Tuesday,September 15 2026"), then the bubbles. Sticks to the bottom
 * while the reader is there — a new line scrolls into view — and holds its
 * place when older history is loaded above.
 */
export function MessageFeed({
  messages,
  isLoading,
  hasOlder,
  isFetchingOlder,
  onLoadOlder,
  canManage,
  onToggleFlag,
  onForward,
  onResend,
  resendingMessageIds,
  authorNames,
  partyName,
  emptyState,
  showJob = true,
  recap = false,
  className,
}: {
  /** Newest first, as the API delivers them. */
  messages: FeedMessage[];
  isLoading?: boolean;
  hasOlder?: boolean;
  isFetchingOlder?: boolean;
  onLoadOlder?: () => void;
  canManage: boolean;
  onToggleFlag?: (message: FeedMessage) => void;
  onForward?: (message: FeedMessage) => void;
  /** Resend a failed line; pass it only to a viewer who may send. */
  onResend?: (message: FeedMessage) => void;
  /** The failed lines whose resends are in flight — each one's button waits. */
  resendingMessageIds?: ReadonlySet<string>;
  authorNames?: Map<string, string>;
  /** The other side's name, for incoming bubbles. */
  partyName?: string;
  emptyState?: ReactNode;
  showJob?: boolean;
  /** The Workiz recap chip at the top of the thread (inbox only). */
  recap?: boolean;
  className?: string;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const lastNewestId = useRef<string | undefined>(undefined);
  const lastOldestId = useRef<string | undefined>(undefined);
  const prevHeight = useRef(0);

  const newestId = messages[0]?.id;
  const oldestId = messages[messages.length - 1]?.id;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const firstPaint = lastNewestId.current === undefined && newestId !== undefined;
    const newestChanged = newestId !== lastNewestId.current;
    const olderLoaded = oldestId !== lastOldestId.current && !newestChanged;

    if (olderLoaded && prevHeight.current) {
      // Keep the same line under the reader's eyes after prepending history.
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (firstPaint) {
      el.scrollTop = el.scrollHeight;
    } else if (newestChanged) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
      const mine = messages[0]?.direction === "outbound";
      if (nearBottom || mine) el.scrollTop = el.scrollHeight;
    }
    lastNewestId.current = newestId;
    lastOldestId.current = oldestId;
    prevHeight.current = el.scrollHeight;
  }, [newestId, oldestId, messages]);

  if (isLoading) {
    return (
      <div className={cn("flex-1 space-y-3 overflow-hidden bg-muted/30 p-4", className)}>
        <Skeleton className="ml-auto h-10 w-2/5" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="ml-auto h-8 w-1/3" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={cn("flex flex-1 items-center justify-center bg-muted/30 p-6", className)}>
        {emptyState ?? (
          <div className="flex flex-col items-center gap-1.5 text-center">
            <MessageSquareDashed className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No messages yet</p>
            <p className="text-xs text-muted-foreground">Write the first one below.</p>
          </div>
        )}
      </div>
    );
  }

  const groups = groupByDay(messages);

  return (
    <div
      ref={scroller}
      className={cn("flex-1 overflow-y-auto bg-muted/30 px-5 pb-10 pt-6", className)}
      data-testid="message-feed"
    >
      {hasOlder ? (
        <div className="mb-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            className="rounded-full"
            disabled={isFetchingOlder}
            onClick={() => {
              if (scroller.current) prevHeight.current = scroller.current.scrollHeight;
              onLoadOlder?.();
            }}
          >
            {isFetchingOlder ? <Loader2 className="size-3.5 animate-spin" /> : "Load older"}
          </Button>
        </div>
      ) : null}

      {groups.map((group, i) => (
        <section key={group.key} className="mb-5 space-y-5">
          <div className="relative flex justify-center">
            {recap && i === 0 ? (
              <div className="absolute left-0 top-0">
                <RecapChip />
              </div>
            ) : null}
            <span className="rounded-full border bg-background px-3.5 py-1 text-xs font-medium text-foreground/80 shadow-xs">
              {group.label}
            </span>
          </div>
          {group.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              authorName={m.sentByUserId ? authorNames?.get(m.sentByUserId) : undefined}
              partyName={partyName}
              canManage={canManage}
              onToggleFlag={onToggleFlag}
              onForward={onForward}
              onResend={onResend}
              resending={!!resendingMessageIds?.has(m.id)}
              showJob={showJob}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

/** "✦ Recap conversation" — Workiz's AI summary chip; a placeholder until BitCRM has an assistant. */
function RecapChip() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex">
          <button
            type="button"
            disabled
            aria-label="Recap conversation"
            className="inline-flex cursor-default items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-semibold text-brand shadow-xs"
          >
            <Sparkles className="size-3.5" /> Recap conversation
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>AI recaps arrive with a later milestone</TooltipContent>
    </Tooltip>
  );
}
