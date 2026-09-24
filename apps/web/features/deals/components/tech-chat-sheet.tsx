"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useConversationByParty } from "@/features/messaging/hooks";
import { ConversationThread } from "@/features/messaging/components/conversation-thread";
import { ThreadComposer } from "@/features/messaging/components/thread-composer";

/**
 * The conversation with a technician, opened beside the job rather than by
 * leaving it. A dispatcher messaging a technician is in the middle of that
 * job, and Workiz keeps them there — the job stays on screen behind the panel.
 */
export function TechChatSheet({
  techId,
  name,
  open,
  onOpenChange,
}: {
  techId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Asked for only while the panel is open: a job with five technicians must
  // not go looking for five threads nobody opened.
  const { data: conversation, isLoading } = useConversationByParty("user", open ? techId : undefined);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[520px] max-w-[96vw] flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">{name}</SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Opening…</p>
        ) : conversation ? (
          <ConversationThread
            conversationId={conversation.id}
            title={name}
            embedded
            className="flex-1"
            footer={({ conversation: c }) => <ThreadComposer conversation={c} />}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            No messages with {name} yet.
          </p>
        )}
      </SheetContent>
    </Sheet>
  );
}
