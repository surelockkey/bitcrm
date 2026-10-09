"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { Ban } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useUserMap } from "@/features/deals/hooks";
import type { FeedMessage, InboxConversation, TextLookupParams } from "../api";
import {
  useConversation,
  useConversationMessages,
  useMarkRead,
  useMessagingAccess,
  useResendMessage,
  useResendingMessageIds,
  useSetMessageFlag,
  useTextLookup,
} from "../hooks";
import { flattenFeed, messageSk, newClientMessageId } from "../lib";
import { MessageFeed } from "./message-feed";
import { ThreadHeader } from "./thread-header";

/** What the opt-out banner asks the server about, for this thread. */
export function textLookupParamsFor(c: InboxConversation | undefined): TextLookupParams | undefined {
  if (!c) return undefined;
  if (c.partyId && (c.partyKind === "contact" || c.partyKind === "company" || c.partyKind === "user")) {
    return { partyKind: c.partyKind, partyId: c.partyId };
  }
  const phone = c.addresses?.phones?.[0];
  return phone ? { address: phone } : undefined;
}

/**
 * The middle pane: header, feed, and whatever the caller puts underneath
 * (the composer). Opening it marks the thread read for the team and moves
 * the viewer's read marker to the newest line; the same happens again
 * when a new inbound message lands while it is open.
 */
export function ConversationThread({
  conversationId,
  title,
  onBack,
  onToggleInfo,
  onForward,
  footer,
  embedded = false,
  extrasIn = true,
  className,
}: {
  conversationId: string;
  title: string;
  onBack?: () => void;
  onToggleInfo?: () => void;
  /** Forward a line into a new message (the bubble's first hover icon). */
  onForward?: (message: FeedMessage) => void;
  /** Rendered under the feed — the composer. */
  footer?: (ctx: { conversation: InboxConversation; optedOut: boolean }) => ReactNode;
  /** Inside a contact / company / job card: no header of its own. */
  embedded?: boolean;
  /**
   * Whether what the caller draws into the thread is in — the inbox's title
   * and the quick replies over its composer. The thread is held until it is.
   */
  extrasIn?: boolean;
  className?: string;
}) {
  const { canManage, canSend } = useMessagingAccess();
  const detail = useConversation(conversationId);
  const feed = useConversationMessages(conversationId);
  const markRead = useMarkRead();
  const setFlag = useSetMessageFlag();
  const resend = useResendMessage();
  const resending = useResendingMessageIds();

  const messages = useMemo(() => flattenFeed(feed.data?.pages), [feed.data]);
  const authorIds = useMemo(
    () => [...new Set(messages.map((m) => m.sentByUserId).filter((id): id is string => !!id))],
    [messages],
  );
  const { map: userMap, isLoading: authorsLoading } = useUserMap(authorIds);
  const authorNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, u] of userMap) m.set(id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || id);
    return m;
  }, [userMap]);

  const conversation = detail.data;
  const lookup = useTextLookup(textLookupParamsFor(conversation));
  const optedOut = lookup.data?.optOut?.status === "opted_out";

  // One skeleton, then the thread whole: the header, the messages with their
  // authors named, the opt-out banner if there is one, and the composer. Each
  // used to land on its own beat, and every one of them moved the feed — the
  // banner and the composer squeeze it from below. Held once, never again.
  const shown = usePageReady(settled(detail) && settled(feed) && settled(lookup) && !authorsLoading && extrasIn);

  // Mark read: once per newest message, only when there is something to clear.
  const newest = messages[0];
  const newestSk = newest ? messageSk(newest) : undefined;
  const behind =
    !!conversation &&
    (conversation.unread || (!!newestSk && conversation.readMarker?.lastReadMessageSk !== newestSk));
  const { mutate: mark, isPending: marking } = markRead;
  useEffect(() => {
    if (!behind || marking || !newestSk) return;
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    mark({ id: conversationId, lastReadMessageSk: newestSk });
    // `behind` flips false once the marker lands; nothing else should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, newestSk, behind]);

  const toggleFlag = (m: FeedMessage) =>
    setFlag.mutate({ conversationId, messageId: m.id, createdAt: m.createdAt, flagged: !m.flagged });
  const resendLine = (m: FeedMessage) =>
    resend.mutate({ conversationId, message: m, clientMessageId: newClientMessageId() });

  if (detail.isError) {
    return (
      <div className={cn("flex flex-1 items-center justify-center p-6 text-center", className)}>
        <div>
          <p className="text-[14px] leading-[21px] font-semibold text-foreground">This conversation is not available</p>
          <p className="text-[14px] leading-[21px] text-wz-outline-label">It may be outside your data scope, or it was removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid="conversation-thread">
      {embedded ? null : shown && conversation ? (
        <ThreadHeader
          conversation={conversation}
          title={title}
          canManage={canManage}
          onBack={onBack}
          onToggleInfo={onToggleInfo}
        />
      ) : (
        // The header's own box: a shorter stand-in let the feed below it
        // slide down when the header came.
        <div className="flex h-[58px] shrink-0 items-center gap-4 border-b border-input bg-background px-4">
          <span className="flex flex-col gap-1.5">
            <Skeleton className="h-3.5 w-36" />
            <Skeleton className="h-3 w-12" />
          </span>
        </div>
      )}

      <MessageFeed
        // Handed over only once shown: the feed scrolls to the newest line
        // the first time it has lines, and that must be the frame it is seen.
        messages={shown ? messages : []}
        isLoading={!shown}
        hasOlder={feed.hasNextPage}
        isFetchingOlder={feed.isFetchingNextPage}
        onLoadOlder={() => feed.fetchNextPage()}
        canManage={canManage}
        onToggleFlag={toggleFlag}
        onForward={onForward}
        // Resend is a send: blocked exactly when the composer is.
        onResend={canSend && !optedOut ? resendLine : undefined}
        resendingMessageIds={resending}
        authorNames={authorNames}
        partyName={title || undefined}
      />

      {shown && optedOut ? (
        <Alert className="mx-4 mb-2 rounded-[4px] border-wz-toast-warning/50 bg-wz-toast-warning/10">
          <Ban className="size-4 text-wz-toast-warning" />
          <AlertTitle>This number opted out of texts</AlertTitle>
          <AlertDescription>
            They replied STOP. Sending is blocked until they text START — a call still works.
          </AlertDescription>
        </Alert>
      ) : null}

      {shown && conversation && footer ? footer({ conversation, optedOut }) : null}
    </div>
  );
}
