"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ConversationKind } from "@bitcrm/types";
import { CONVERSATION_KINDS } from "@bitcrm/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { INBOX_VIEWS, type InboxView } from "../api";
import {
  useConversation,
  useConversations,
  useInboxCounters,
  useMessagingAccess,
  usePartyNames,
  useTemplates,
} from "../hooks";
import { useInboxNavigate } from "../inbox-url";
import { conversationTitle, type ListState } from "../lib";
import { ConversationList } from "./conversation-list";
import { ConversationThread } from "./conversation-thread";
import { InboxCategories, useCategoriesCollapsed } from "./inbox-categories";
import { NewConversationDialog } from "./new-conversation-dialog";
import { NoConversationSelectedArt } from "./inbox-art";
import { PartyCard } from "./party-card";
import { ThreadComposer } from "./thread-composer";

const isView = (v: string | null): v is InboxView => !!v && (INBOX_VIEWS as readonly string[]).includes(v);
const isKind = (v: string | null): v is ConversationKind =>
  !!v && (CONVERSATION_KINDS as readonly string[]).includes(v);

/**
 * `/messages` — the Workiz Inbox in three columns: the categories, the
 * conversation list, and the open thread. The party's card opens as a side
 * sheet from the thread header's person icon. The open thread and the
 * category live in the URL (`?c=&view=&kind=`) so a link from a job or a
 * contact opens the right conversation, and the back button behaves.
 */
export function InboxPage() {
  const params = useSearchParams();
  const navigate = useInboxNavigate();
  const { canView, canSend, isLoading } = useMessagingAccess();

  const selectedId = params.get("c") ?? undefined;
  const view: InboxView = isView(params.get("view")) ? (params.get("view") as InboxView) : "all";
  const kindParam = params.get("kind");
  const kind = isKind(kindParam) ? kindParam : undefined;
  const [search, setSearch] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [composingNew, setComposingNew] = useState(false);
  /** A message being forwarded: the New message dialog opens with its text. */
  const [forwardBody, setForwardBody] = useState<string | undefined>(undefined);
  const [collapsed, toggleCollapsed] = useCategoriesCollapsed();

  const listState: ListState = useMemo(() => ({ view, kind, search }), [view, kind, search]);
  const onListState = (next: ListState) => {
    setSearch(next.search);
    if (next.view !== view || next.kind !== kind) navigate({ view: next.view, kind: next.kind });
  };

  // The category numbers and the rows come from two requests that answer on
  // their own beats, and each number pushed its unread dot aside when it
  // landed. Both are asked for here (the same queries the columns read), and
  // the numbers, the dots and the rows are drawn in one frame: the numbers
  // once and kept, the rows again for each category, like any new list.
  const counters = useInboxCounters();
  const listFilter = useMemo(() => ({ view, kind: view === "all" ? kind : undefined }), [view, kind]);
  const list = useConversations(listFilter);
  const inboxIn = !isLoading && settled(counters) && settled(list);
  const countsShown = usePageReady(inboxIn);
  const rowsShown = usePageReady(inboxIn, JSON.stringify(listFilter));

  const { data: selected } = useConversation(selectedId);
  const names = usePartyNames(selected ? [selected] : []);
  const title = selected ? conversationTitle(selected, names) : "";
  // What the inbox draws into an open thread: its title, and the quick
  // replies over its composer (the same query the chips read). The thread
  // waits for them — the title used to change from a number to a name, and
  // the chips to land on top of the composer, after the thread was up.
  const quickReplies = useTemplates({ channel: "sms" }, canSend && !!selectedId);
  const threadExtrasIn = !names.isLoading && settled(quickReplies);

  if (!isLoading && !canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-[14px] leading-[21px] font-semibold text-foreground">No access</h2>
        <p className="text-[14px] leading-[21px] text-wz-outline-label">You don&apos;t have permission to view messages.</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1" data-testid="inbox">
      {/* Column 1 — categories. Off-screen on phones, where the list and the thread take turns. */}
      <InboxCategories
        state={listState}
        onStateChange={onListState}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        countsShown={countsShown}
        className="max-md:hidden"
      />

      {/* Column 2 — the conversations. */}
      {/* Workiz: 319px + a 1px #ccc rule (pg_messages_wz_01_list). */}
      <aside
        className={cn("w-full shrink-0 border-r border-input md:flex md:w-80", selectedId ? "hidden" : "flex")}
        aria-label="Conversations"
      >
        <ConversationList
          state={listState}
          onStateChange={onListState}
          selectedId={selectedId}
          onSelect={(id) => navigate({ c: id })}
          onNewConversation={() => setComposingNew(true)}
          rowsShown={rowsShown}
          className="w-full"
        />
      </aside>

      {/* Column 3 — the thread. */}
      {/* The thread pane: Workiz's `ms_container`, #f7f8f8. */}
      <section
        className={cn("min-w-0 flex-1 flex-col bg-wz-tile md:flex", selectedId ? "flex" : "hidden")}
        aria-label="Conversation"
      >
        {selectedId ? (
          <ConversationThread
            key={selectedId}
            conversationId={selectedId}
            title={title}
            extrasIn={threadExtrasIn}
            onBack={() => navigate({ c: undefined })}
            onToggleInfo={() => setInfoOpen(true)}
            onForward={(m) => {
              setForwardBody(m.body ?? "");
              setComposingNew(true);
            }}
            footer={({ conversation, optedOut }) => (
              <ThreadComposer conversation={conversation} optedOut={optedOut} autoFocus />
            )}
          />
        ) : (
          // Workiz's empty pane: its 58px white bar over the #f7f8f8 pane, the
          // two-bubble picture 117px under the bar (15px of it its own margin)
          // and two 14px/21px lines under it.
          <>
            <div className="h-[58px] shrink-0 border-b border-input bg-background" />
            <div className="flex flex-1 flex-col items-center px-8 pt-[102px] text-center">
              <NoConversationSelectedArt className="mt-[15px]" />
              <p className="text-[14px] leading-[21px] font-semibold text-foreground">No conversation selected</p>
              <p className="text-[14px] leading-[21px] text-wz-outline-label">Please select a conversation to begin</p>
            </div>
          </>
        )}
      </section>

      <NewConversationDialog
        open={composingNew}
        onOpenChange={(open) => {
          setComposingNew(open);
          if (!open) setForwardBody(undefined);
        }}
        onCreated={(id) => navigate({ c: id, view: "all", kind: undefined })}
        initialBody={forwardBody}
      />

      {/* The party's card — Workiz's client page — opens from the header's person icon. */}
      <Sheet open={infoOpen && !!selected} onOpenChange={setInfoOpen}>
        <SheetContent side="right" className="w-full p-0 sm:max-w-sm">
          <SheetHeader className="sr-only">
            <SheetTitle>{title}</SheetTitle>
          </SheetHeader>
          {selected ? <PartyCard conversation={selected} title={title} /> : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}
