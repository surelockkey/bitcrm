"use client";

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import type { TextLookupPartyKind } from "../api";
import { PartyChat } from "./party-chat";

/**
 * "Text" next to a client, a company or a technician — opens their thread
 * in a dialog (or the composer for the first message). Hidden from anyone
 * who may not send.
 */
export function TextButton({
  partyKind,
  partyId,
  name,
  dealId,
  label = "Text",
  variant = "outline",
  size = "sm",
  className,
}: {
  partyKind: TextLookupPartyKind;
  partyId: string;
  /** Shown in the dialog title. */
  name?: string;
  dealId?: string;
  label?: string;
  variant?: "outline" | "ghost" | "brand" | "secondary";
  size?: "sm" | "xs" | "default" | "lg";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { can } = usePermissions();
  if (!can("messages", "send")) return null;

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={cn("gap-1.5", className)}
        onClick={() => setOpen(true)}
        aria-label={name ? `Text ${name}` : label}
      >
        <MessageSquare className="size-3.5" /> {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[min(80vh,40rem)] flex-col gap-0 p-0 sm:max-w-xl">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-base">Text {name ?? ""}</DialogTitle>
            <DialogDescription>
              {partyKind === "user" ? "Team chat" : "SMS — the client sees your workspace number."}
            </DialogDescription>
          </DialogHeader>
          {open ? (
            <PartyChat partyKind={partyKind} partyId={partyId} dealId={dealId} autoFocus className="m-3 flex-1" />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
