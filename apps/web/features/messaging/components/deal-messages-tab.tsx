"use client";

import { useMemo } from "react";
import { Ban, MessagesSquare } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useContact } from "@/features/clients/hooks";
import { contactName, initials } from "@/features/clients/lib";
import { useUserMap } from "@/features/deals/hooks";
import type { FeedMessage, SendMessageBody } from "../api";
import {
  useConversationByJob,
  useMessagesByJob,
  useMessagingAccess,
  useSendToParty,
  useSetMessageFlag,
  useTextLookup,
} from "../hooks";
import { flattenFeed } from "../lib";
import { Composer } from "./composer";
import { MessageFeed } from "./message-feed";
import { TextButton } from "./text-button";
import { ThreadComposer } from "./thread-composer";

/**
 * The job page's "Messages" tab (design §8.2): every message that
 * referenced this job, newest at the bottom, and a composer that writes
 * to the job's client thread with the job attached — plus "Text client"
 * and a "Text" per assigned technician, as on the Workiz job card.
 */
export function DealMessagesTab({ deal }: { deal: Deal }) {
  const { canView, canSend, canManage } = useMessagingAccess();
  const feed = useMessagesByJob(canView ? deal.id : undefined);
  const { data: conversation } = useConversationByJob(canView ? deal.id : undefined);
  const lookup = useTextLookup({ partyKind: "contact", partyId: deal.contactId }, canView && !!deal.contactId);
  const { data: contact } = useContact(deal.contactId);
  const { map: techMap } = useUserMap(deal.assignedTechIds);
  const send = useSendToParty();
  const setFlag = useSetMessageFlag();

  const messages = useMemo(() => flattenFeed(feed.data?.pages), [feed.data]);
  const authorIds = useMemo(
    () => [...new Set(messages.map((m) => m.sentByUserId).filter((id): id is string => !!id))],
    [messages],
  );
  const { map: authorMap } = useUserMap(authorIds);
  const authorNames = useMemo(() => {
    const m = new Map<string, string>();
    for (const [id, u] of authorMap) m.set(id, `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() || id);
    return m;
  }, [authorMap]);

  if (!canView) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        You don&apos;t have permission to view messages.
      </p>
    );
  }

  const optedOut = lookup.data?.optOut?.status === "opted_out";
  const clientName = contact ? contactName(contact) : "client";
  const toggleFlag = (m: FeedMessage) =>
    setFlag.mutate({ conversationId: m.conversationId, messageId: m.id, createdAt: m.createdAt, flagged: !m.flagged });
  const sendFirst = (body: SendMessageBody) =>
    send.mutateAsync({ ...body, dealId: deal.id, contactId: deal.contactId });

  return (
    <div className="flex h-[min(70vh,44rem)] flex-col overflow-hidden rounded-lg border">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <MessagesSquare className="size-4 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Messages about job #{deal.dealNumber}</div>
          <div className="text-xs text-muted-foreground">
            Texts sent with this job attached, from any thread.
          </div>
        </div>
        {deal.contactId ? (
          <TextButton partyKind="contact" partyId={deal.contactId} name={clientName} dealId={deal.id} label="Text client" variant="brand" />
        ) : null}
      </div>

      {deal.assignedTechIds?.length ? (
        <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2 text-xs">
          <span className="mr-1 font-semibold uppercase tracking-wide text-muted-foreground">Team</span>
          {deal.assignedTechIds.map((id) => {
            const u = techMap.get(id);
            const name = u ? `${u.firstName} ${u.lastName}`.trim() : id;
            return (
              <span key={id} className="inline-flex items-center gap-1.5 rounded-full border bg-muted/50 py-0.5 pl-0.5 pr-1">
                <span className="grid size-5 place-items-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">
                  {initials(u?.firstName ?? name, u?.lastName ?? "")}
                </span>
                <span className="font-medium">{name}</span>
                <TextButton partyKind="user" partyId={id} name={name} dealId={deal.id} variant="ghost" size="xs" />
              </span>
            );
          })}
        </div>
      ) : null}

      <MessageFeed
        messages={messages}
        isLoading={feed.isLoading}
        hasOlder={feed.hasNextPage}
        isFetchingOlder={feed.isFetchingNextPage}
        onLoadOlder={() => feed.fetchNextPage()}
        canManage={canManage}
        onToggleFlag={toggleFlag}
        authorNames={authorNames}
        showJob={false}
        emptyState={
          <div className="flex flex-col items-center gap-1.5 text-center">
            <MessagesSquare className="size-6 text-muted-foreground" />
            <p className="text-sm font-medium">No messages about this job yet</p>
            <p className="text-xs text-muted-foreground">Texts sent from here carry the job number.</p>
          </div>
        }
      />

      {optedOut ? (
        <Alert className="mx-3 mb-2 border-amber-500/40 bg-amber-500/5">
          <Ban className="size-4 text-amber-600" />
          <AlertTitle>The client opted out of texts</AlertTitle>
          <AlertDescription>They replied STOP. Sending is blocked until they text START — a call still works.</AlertDescription>
        </Alert>
      ) : null}

      {canSend && deal.contactId ? (
        conversation ? (
          <ThreadComposer conversation={conversation} dealId={deal.id} optedOut={optedOut} />
        ) : (
          <Composer
            contactId={deal.contactId}
            dealId={deal.id}
            optedOut={optedOut}
            disabled={lookup.data ? !lookup.data.canText && !optedOut : false}
            onSend={sendFirst}
            placeholder={`Text ${clientName} about this job…`}
          />
        )
      ) : null}
    </div>
  );
}
