"use client";

import { Phone } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PartyChat } from "@/features/messaging/components/party-chat";
import { startCall } from "@/features/telephony/softphone-manager";

/**
 * A real conversation with the technician, opened beside the job rather than
 * by leaving it: a dispatcher messaging a technician is in the middle of that
 * job, and Workiz keeps them there.
 *
 * It is a chat, not a view of one. `PartyChat` writes to whatever thread the
 * technician has and starts one when there is none — "no messages yet" is the
 * moment you most want to write, not a dead end. The job travels with the
 * message, so it lands on the job's feed too.
 *
 * Calling sits in the header, as it does in Workiz: reaching for the phone
 * mid-conversation is the commonest thing to do next, and it should not mean
 * closing the panel to find the button underneath.
 */
export function TechChatSheet({
  techId,
  name,
  phone,
  dealId,
  open,
  onOpenChange,
}: {
  techId: string;
  name: string;
  /** Their own number: the header calls it without leaving the chat. */
  phone?: string;
  /** The job being worked on: recorded on every message sent from here. */
  dealId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // Wide enough to hold a conversation. The `data-[side=right]` prefix is
        // not decoration: `SheetContent` caps a right-hand sheet with an
        // attribute selector, and a plain `sm:max-w-[…]` here loses to it on
        // specificity, leaving the panel at 384px whatever number is written.
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]"
      >
        <SheetHeader className="space-y-2 border-b px-4 py-3">
          <SheetTitle className="text-center text-base">{name}</SheetTitle>
          {phone ? (
            <button
              type="button"
              onClick={() => startCall(phone)}
              // `rounded-chip`, not an oval: Workiz has no padded pills, and a
              // guard test in this repo holds that line.
              className="inline-flex w-fit items-center gap-1.5 rounded-chip border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Phone className="size-4" /> Call
            </button>
          ) : null}
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
