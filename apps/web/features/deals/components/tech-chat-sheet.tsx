"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PartyChat } from "@/features/messaging/components/party-chat";

/**
 * A real conversation with the technician, opened beside the job rather than
 * by leaving it: a dispatcher messaging a technician is in the middle of that
 * job, and Workiz keeps them there.
 *
 * It is a chat, not a view of one. `PartyChat` writes to whatever thread the
 * technician has and starts one when there is none — "no messages yet" is the
 * moment you most want to write, not a dead end. The job travels with the
 * message, so it lands on the job's feed too.
 */
export function TechChatSheet({
  techId,
  name,
  dealId,
  open,
  onOpenChange,
}: {
  techId: string;
  name: string;
  /** The job being worked on: recorded on every message sent from here. */
  dealId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[520px] max-w-[96vw] flex-col gap-0 p-0 sm:max-w-[520px]">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="text-base">{name}</SheetTitle>
        </SheetHeader>
        {/* Mounted only while open: a job with five technicians must not go
            looking for five threads nobody opened. */}
        {open ? (
          <PartyChat partyKind="user" partyId={techId} dealId={dealId} autoFocus className="m-3 flex-1" />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
