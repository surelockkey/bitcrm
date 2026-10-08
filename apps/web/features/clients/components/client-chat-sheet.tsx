"use client";

import { Phone } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PartyChat } from "@/features/messaging/components/party-chat";
import { startCall } from "@/features/telephony/softphone-manager";

/**
 * The client's SMS thread beside the card rather than on a tab of it — the
 * way the technician's chat sits beside the job. The message button next to
 * the phone number opens it; Call sits in the header, as in Workiz, so
 * reaching for the phone mid-conversation doesn't mean closing the panel.
 */
export function ClientChatSheet({
  contactId,
  name,
  phone,
  phoneOnContact,
  dealId,
  open,
  onOpenChange,
}: {
  contactId: string;
  name: string;
  /** The client's primary number: the header calls it without leaving the chat. */
  phone?: string;
  /**
   * Set (true or false) when `phone` is also the number to text — the job
   * page's, which may be the job's own and not on the client record.
   */
  phoneOnContact?: boolean;
  /** The job the texts are about (job page). */
  dealId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        // The `data-[side=right]` prefix is what lets the width land: the
        // primitive caps a right-hand sheet with an attribute selector that
        // outranks a plain `sm:max-w-[…]`.
        className="flex flex-col gap-0 p-0 data-[side=right]:w-full data-[side=right]:sm:max-w-[640px]"
      >
        <SheetHeader className="space-y-2 border-b px-4 py-3">
          <SheetTitle className="text-center text-base">{name}</SheetTitle>
          <SheetDescription className="sr-only">SMS — the client sees your workspace number.</SheetDescription>
          {phone ? (
            <button
              type="button"
              onClick={() => startCall(phone)}
              className="inline-flex w-fit items-center gap-1.5 rounded-chip border px-3 py-1.5 text-sm transition-colors hover:bg-accent"
            >
              <Phone className="size-4" /> Call
            </button>
          ) : null}
        </SheetHeader>
        {/* Mounted only while open: the card must not fetch a thread nobody asked for. */}
        {open ? (
          <PartyChat
            partyKind="contact"
            partyId={contactId}
            dealId={dealId}
            {...(phone && phoneOnContact !== undefined ? { address: phone, addressOnParty: phoneOnContact } : {})}
            autoFocus
            className="m-3 flex-1"
          />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
