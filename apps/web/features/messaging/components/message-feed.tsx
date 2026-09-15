"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Loader2, MessageSquareDashed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { FeedMessage } from "../api";
import { groupByDay } from "../lib";
import { MessageBubble } from "./message-bubble";

const NEAR_BOTTOM_PX = 120;

/**
 * The thread, newest at the bottom with a separator per day (Workiz
 * `day_title`). Sticks to the bottom while the reader is there — a new
 * line scrolls into view — and holds its place when older history is
 * loaded above.
 */
export function MessageFeed({
  messages,
  isLoading,
  hasOlder,
  isFetchingOlder,
  onLoadOlder,
  canManage,
  onToggleFlag,
  authorNames,
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
  authorNames?: Map<string, string>;
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
      <div className={cn("flex-1 space-y-3 overflow-hidden p-4", className)}>
        <Skeleton className="ml-auto h-10 w-2/5" />
        <Skeleton className="h-12 w-1/2" />
        <Skeleton className="ml-auto h-8 w-1/3" />
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div className={cn("flex flex-1 items-center justify-center p-6", className)}>
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
    <div ref={scroller} className={cn("flex-1 overflow-y-auto px-4 py-3", className)} data-testid="message-feed">
      {hasOlder ? (
        <div className="mb-3 flex justify-center">
          <Button
            variant="outline"
            size="sm"
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

      {groups.map((group) => (
        <section key={group.key} className="mb-3 space-y-2">
          <div className="sticky top-0 z-[1] flex justify-center py-1">
            <span className="rounded-full border bg-background/90 px-2.5 py-0.5 text-[11px] font-medium text-muted-foreground backdrop-blur">
              {group.label}
            </span>
          </div>
          {group.messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              authorName={m.sentByUserId ? authorNames?.get(m.sentByUserId) : undefined}
              canManage={canManage}
              onToggleFlag={onToggleFlag}
              showJob={showJob}
            />
          ))}
        </section>
      ))}
    </div>
  );
}
