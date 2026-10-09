"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FeedMessage } from "../api";
import { groupByDay } from "../lib";
import { WzBounceDots } from "./bounce-dots";
import { MessageBubble } from "./message-bubble";

const NEAR_BOTTOM_PX = 120;

/**
 * The thread, newest at the bottom, as Workiz lays it out
 * (`ms_scrollable-content` + `messages_container`, pg_messages_wz_07_*): the
 * pane's #f7f8f8 under a rgba(62,75,81,.04) wash, 25px of air on top and 40px
 * under the last line; a sticky day chip per day ("Tuesday,September 15
 * 2026": 12px/16px #404040 on white, 1px #e3e3e3, r70, 4px 11px), then the
 * bubbles. Workiz's AI "Recap conversation" chip is left out: there is no AI
 * behind it here. Sticks to the bottom while the reader is there — a new
 * line scrolls into view — and holds its place when older history is loaded
 * above.
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
      <div className={cn("flex-1 space-y-6 overflow-hidden bg-[rgba(62,75,81,0.04)] px-5 pt-[25px]", className)}>
        <Skeleton className="ml-auto h-24 w-3/5 rounded-[25px] rounded-br-none" />
        <Skeleton className="h-20 w-3/5 rounded-[25px] rounded-bl-none" />
        <Skeleton className="ml-auto h-16 w-3/5 rounded-[25px] rounded-br-none" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={cn("flex flex-1 items-center justify-center bg-[rgba(62,75,81,0.04)] p-6", className)}>
        {emptyState ?? (
          <div className="flex flex-col items-center text-center">
            <p className="text-[14px] leading-[21px] font-semibold text-foreground">No messages yet</p>
            <p className="text-[14px] leading-[21px] text-wz-outline-label">Write the first one below.</p>
          </div>
        )}
      </div>
    );
  }

  const groups = groupByDay(messages);

  return (
    <div
      ref={scroller}
      className={cn("flex-1 overflow-y-auto bg-[rgba(62,75,81,0.04)] pb-10", className)}
      data-testid="message-feed"
    >
      <div aria-hidden className="h-[25px]" />
      {hasOlder ? (
        <div className="flex h-8 items-center justify-center">
          {isFetchingOlder ? (
            <WzBounceDots />
          ) : (
            <button
              type="button"
              className="text-[13px] leading-[19px] font-semibold text-wz-link hover:underline"
              onClick={() => {
                if (scroller.current) prevHeight.current = scroller.current.scrollHeight;
                onLoadOlder?.();
              }}
            >
              Load older
            </button>
          )}
        </div>
      ) : null}

      <div className="flex flex-col">
        {groups.map((group) => (
          <section key={group.key} className="contents">
            <div className="sticky top-0 z-20 flex w-fit self-center p-1">
              <span className="rounded-[70px] border border-[#e3e3e3] bg-background px-[11px] py-1 text-[12px] leading-4 text-wz-strong">
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
    </div>
  );
}
