"use client";

import { useCallback, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ConversationKind } from "@bitcrm/types";
import { CONVERSATION_KINDS } from "@bitcrm/types";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { INBOX_VIEWS, type InboxView } from "../api";
import { useConversation, useMessagingAccess, usePartyNames } from "../hooks";
import { conversationTitle, type ListState } from "../lib";
import { ConversationList } from "./conversation-list";
import { ConversationThread } from "./conversation-thread";
import { InboxCategories, useCategoriesCollapsed } from "./inbox-categories";
import { NewConversationDialog } from "./new-conversation-dialog";
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
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { canView, isLoading } = useMessagingAccess();

  const selectedId = params.get("c") ?? undefined;
  const view: InboxView = isView(params.get("view")) ? (params.get("view") as InboxView) : "all";
  const kindParam = params.get("kind");
  const kind = isKind(kindParam) ? kindParam : undefined;
  const [search, setSearch] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);
  const [composingNew, setComposingNew] = useState(false);
  const [collapsed, toggleCollapsed] = useCategoriesCollapsed();

  const navigate = useCallback(
    (next: { c?: string; view?: InboxView; kind?: ConversationKind }) => {
      const qs = new URLSearchParams(params.toString());
      const apply = (key: string, value?: string) => (value ? qs.set(key, value) : qs.delete(key));
      if ("c" in next) apply("c", next.c);
      if ("view" in next) apply("view", next.view === "all" ? undefined : next.view);
      if ("kind" in next) apply("kind", next.kind);
      const s = qs.toString();
      router.replace(s ? `${pathname}?${s}` : pathname, { scroll: false });
    },
    [params, pathname, router],
  );

  const listState: ListState = useMemo(() => ({ view, kind, search }), [view, kind, search]);
  const onListState = (next: ListState) => {
    setSearch(next.search);
    if (next.view !== view || next.kind !== kind) navigate({ view: next.view, kind: next.kind });
  };

  const { data: selected } = useConversation(selectedId);
  const names = usePartyNames(selected ? [selected] : []);
  const title = selected ? conversationTitle(selected, names) : "";

  if (!isLoading && !canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view messages.</p>
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
        className="max-md:hidden"
      />

      {/* Column 2 — the conversations. */}
      <aside
        className={cn("w-full shrink-0 border-r md:flex md:w-80", selectedId ? "hidden" : "flex")}
        aria-label="Conversations"
      >
        <ConversationList
          state={listState}
          onStateChange={onListState}
          selectedId={selectedId}
          onSelect={(id) => navigate({ c: id })}
          onNewConversation={() => setComposingNew(true)}
          className="w-full"
        />
      </aside>

      {/* Column 3 — the thread. */}
      <section
        className={cn("min-w-0 flex-1 flex-col md:flex", selectedId ? "flex" : "hidden")}
        aria-label="Conversation"
      >
        {selectedId ? (
          <ConversationThread
            key={selectedId}
            conversationId={selectedId}
            title={title}
            onBack={() => navigate({ c: undefined })}
            onToggleInfo={() => setInfoOpen(true)}
            footer={({ conversation, optedOut }) => (
              <ThreadComposer conversation={conversation} optedOut={optedOut} autoFocus />
            )}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center bg-muted/30 p-8 text-center">
            <NoConversationSelected />
            <p className="mt-4 text-[15px] font-semibold">No conversation selected</p>
            <p className="mt-1 text-[15px] text-muted-foreground">Please select a conversation to begin</p>
          </div>
        )}
      </section>

      <NewConversationDialog
        open={composingNew}
        onOpenChange={setComposingNew}
        onCreated={(id) => navigate({ c: id, view: "all", kind: undefined })}
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

/** Workiz's "nothing open" picture: two speech bubbles with dots on a pale disc. */
function NoConversationSelected() {
  return (
    <svg width="152" height="152" viewBox="0 0 152 152" aria-hidden className="text-foreground/70">
      <circle cx="76" cy="76" r="60" className="fill-muted" />
      <path
        d="M30 28 h68 a8 8 0 0 1 8 8 v40 a8 8 0 0 1 -8 8 h-40 l-16 14 v-14 h-12 a8 8 0 0 1 -8 -8 v-40 a8 8 0 0 1 8 -8 z"
        className="fill-background stroke-current"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="50" cy="56" r="4" className="fill-emerald-500" />
      <circle cx="64" cy="56" r="4" className="fill-emerald-500" />
      <circle cx="78" cy="56" r="4" className="fill-emerald-500" />
      <path
        d="M90 70 h40 a6 6 0 0 1 6 6 v24 a6 6 0 0 1 -6 6 h-6 v10 l-12 -10 h-22 a6 6 0 0 1 -6 -6 v-24 a6 6 0 0 1 6 -6 z"
        className="fill-background stroke-current"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      <circle cx="101" cy="88" r="3.5" className="fill-amber-400" />
      <circle cx="112" cy="88" r="3.5" className="fill-amber-400" />
      <circle cx="123" cy="88" r="3.5" className="fill-amber-400" />
    </svg>
  );
}
