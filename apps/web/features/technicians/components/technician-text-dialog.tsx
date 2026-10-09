"use client";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PartyChat } from "@/features/messaging/components/party-chat";

/**
 * The team chat with this person, opened from the card's Actions — what the
 * "Text" button beside the name used to open (`TextButton`'s dialog), now an
 * Actions row as Workiz keeps its page actions there.
 */
export function TechnicianTextDialog({
  technicianId,
  name,
  open,
  onOpenChange,
}: {
  technicianId: string;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(80vh,40rem)] flex-col gap-0 p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="text-base">Text {name}</DialogTitle>
          <DialogDescription>Team chat</DialogDescription>
        </DialogHeader>
        {open ? <PartyChat partyKind="user" partyId={technicianId} autoFocus className="m-3 flex-1" /> : null}
      </DialogContent>
    </Dialog>
  );
}
