"use client";

import { useEffect, useMemo, type ReactNode } from "react";
import { Ban } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useUserMap } from "@/features/deals/hooks";
import type { FeedMessage, InboxConversation, TextLookupParams } from "../api";
import {
  useConversation,
  useConversationMessages,
  useMarkRead,
  useMessagingAccess,
  useResendMessage,
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
  className?: string;
}) {
  const { canManage, canSend } = useMessagingAccess();
  const detail = useConversation(conversationId);
  const feed = useConversationMessages(conversationId);
  const markRead = useMarkRead();
  const setFlag = useSetMessageFlag();
  const resend = useResendMessage();

  const messages = useMemo(() => flattenFeed(feed.data?.pages), [feed.data]);
  const authorIds = useMemo(
    () => [...new Set(messages.map((m) => m.sentByUserId).filter((id): id is string => !!id))],
    [messages],
  );
  const { map: userMap } = useUserMap(authorIds);
  const authorNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, u] of userMap) m.set(id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || id);
    return m;
  }, [userMap]);

  const conversation = detail.data;
  const lookup = useTextLookup(textLookupParamsFor(conversation));
  const optedOut = lookup.data?.optOut?.status === "opted_out";

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
          <p className="text-sm font-medium">This conversation is not available</p>
          <p className="text-xs text-muted-foreground">It may be outside your data scope, or it was removed.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)} data-testid="conversation-thread">
      {embedded ? null : conversation ? (
        <ThreadHeader
          conversation={conversation}
          title={title}
          canManage={canManage}
          onBack={onBack}
          onToggleInfo={onToggleInfo}
        />
      ) : (
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Skeleton className="size-6 rounded-full" />
          <Skeleton className="h-4 w-40" />
        </div>
      )}

      <MessageFeed
        messages={messages}
        isLoading={feed.isLoading}
        hasOlder={feed.hasNextPage}
        isFetchingOlder={feed.isFetchingNextPage}
        onLoadOlder={() => feed.fetchNextPage()}
        canManage={canManage}
        onToggleFlag={toggleFlag}
        onForward={onForward}
        onResend={canSend ? resendLine : undefined}
        resendingMessageId={resend.isPending ? resend.variables?.message.id : undefined}
        authorNames={authorNames}
        partyName={title || undefined}
        recap={!embedded}
      />

      {optedOut ? (
        <Alert className="mx-3 mb-2 border-amber-500/40 bg-amber-500/5">
          <Ban className="size-4 text-amber-600" />
          <AlertTitle>This number opted out of texts</AlertTitle>
          <AlertDescription>
            They replied STOP. Sending is blocked until they text START — a call still works.
          </AlertDescription>
        </Alert>
      ) : null}

      {conversation && footer ? footer({ conversation, optedOut }) : null}
    </div>
  );
}
