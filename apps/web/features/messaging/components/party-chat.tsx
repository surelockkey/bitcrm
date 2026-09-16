"use client";

import { Ban, MessageSquareDashed } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { SendMessageBody, TextLookupPartyKind } from "../api";
import { useMessagingAccess, useSendToParty, useTextLookup } from "../hooks";
import { Composer } from "./composer";
import { ConversationThread } from "./conversation-thread";
import { ThreadComposer } from "./thread-composer";

/**
 * A party's thread wherever their record is shown — the contact card, the
 * company card, the "Text" dialog. With no thread yet, it is the composer
 * for the first message; the server opens the thread on send and the
 * lookup refetches into it.
 */
export function PartyChat({
  partyKind,
  partyId,
  dealId,
  autoFocus,
  className,
}: {
  partyKind: TextLookupPartyKind;
  partyId: string;
  /** The job the conversation is about (job page); recorded on sends. */
  dealId?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const { canView, canSend } = useMessagingAccess();
  const lookup = useTextLookup({ partyKind, partyId }, canView);
  const send = useSendToParty();

  if (!canView) {
    return (
      <p className={cn("rounded-lg border border-dashed p-4 text-center text-xs text-muted-foreground", className)}>
        You don&apos;t have permission to view messages.
      </p>
    );
  }
  if (lookup.isLoading || !lookup.data) {
    return <Skeleton className={cn("h-40 w-full", className)} />;
  }

  const { conversation, address, addressMasked, optOut, canText } = lookup.data;
  const optedOut = optOut?.status === "opted_out";

  if (conversation) {
    return (
      <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border", className)}>
        <ConversationThread
          conversationId={conversation.id}
          title=""
          embedded
          footer={({ conversation: c, optedOut: blocked }) => (
            <ThreadComposer conversation={c} optedOut={blocked} dealId={dealId} autoFocus={autoFocus} />
          )}
        />
      </div>
    );
  }

  // No thread yet: only a contact (by id) or a known number can start one.
  // A teammate's chat is opened by the team-chat milestone, not from here.
  const startable =
    partyKind === "contact" || (partyKind === "company" && !!address && !addressMasked);

  const sendFirst = (body: SendMessageBody) =>
    send.mutateAsync(
      partyKind === "contact"
        ? { ...body, dealId, contactId: partyId }
        : { ...body, dealId, phone: address as string },
    );

  return (
    <div className={cn("flex min-h-0 flex-col overflow-hidden rounded-lg border", className)}>
      <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-6 text-center">
        <MessageSquareDashed className="size-6 text-muted-foreground" />
        <p className="text-sm font-medium">No messages yet</p>
        <p className="text-xs text-muted-foreground">
          {partyKind === "user"
            ? "Team chat with technicians arrives with the team-chat milestone."
            : !canText && !optedOut
              ? addressMasked
                ? "Their number is hidden from you, so the first text has to come from someone who can see it."
                : "No phone number on file — add one to text them."
              : "Write the first one below."}
        </p>
      </div>
      {optedOut ? (
        <Alert className="mx-3 mb-2 border-amber-500/40 bg-amber-500/5">
          <Ban className="size-4 text-amber-600" />
          <AlertTitle>This number opted out of texts</AlertTitle>
          <AlertDescription>They replied STOP. Sending is blocked until they text START.</AlertDescription>
        </Alert>
      ) : null}
      {canSend && startable ? (
        <Composer
          contactId={partyKind === "contact" ? partyId : undefined}
          dealId={dealId}
          optedOut={optedOut}
          disabled={!canText && !optedOut}
          autoFocus={autoFocus}
          onSend={sendFirst}
        />
      ) : null}
    </div>
  );
}
