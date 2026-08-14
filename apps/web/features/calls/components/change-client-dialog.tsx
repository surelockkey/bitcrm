"use client";

import { useState } from "react";
import { Loader2, Search, UserPlus } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useContacts } from "@/features/clients/hooks";
import { contactName, formatPhone } from "@/features/clients/lib";
import { useSetCallParty } from "../hooks";
import { counterparty, formatEndpoint, type CallRecord } from "../lib";

/**
 * Correct who a call was with. Automatic matching goes by phone number, which
 * is right until a number gets reassigned or somebody rings from a phone
 * that isn't theirs — then a person has to be able to say so.
 *
 * The choice sticks: the record is marked as set by hand, and automatic
 * matching never touches it again.
 */
export function ChangeClientDialog({
  call,
  onClose,
}: {
  /** null keeps the dialog closed. */
  call: CallRecord | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const setParty = useSetCallParty();
  const { data: contacts, isLoading } = useContacts();

  if (!call) return null;

  const client = counterparty(call);
  // Whichever side isn't ours is the side being corrected.
  const side: "from" | "to" =
    call.fromParty?.kind === "user" ? "to" : "from";

  const q = query.trim().toLowerCase();
  const matches = (contacts ?? []).filter((c) =>
    `${contactName(c)} ${c.phones.join(" ")}`.toLowerCase().includes(q),
  );

  const choose = (contactId: string) => {
    setParty.mutate(
      { sid: call.callSid, side, kind: "contact", id: contactId },
      { onSuccess: onClose },
    );
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Change client on this call</DialogTitle>
          <DialogDescription>
            Currently {client.name ?? formatEndpoint(client.number)}. Changing it
            affects this call only — other calls from{" "}
            {formatEndpoint(client.number)} keep whoever they matched.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search clients by name or number…"
            className="h-9 pl-8"
            autoFocus
          />
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ) : matches.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <p className="text-sm text-muted-foreground">No client matches.</p>
              {client.number ? (
                <Button variant="outline" size="sm" className="gap-1.5" asChild>
                  <a href={`/contacts?new=${encodeURIComponent(client.number)}`}>
                    <UserPlus className="size-3.5" /> Create a new client
                  </a>
                </Button>
              ) : null}
            </div>
          ) : (
            <ul className="divide-y">
              {matches.slice(0, 40).map((contact) => (
                <li key={contact.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:bg-accent"
                    disabled={setParty.isPending}
                    onClick={() => choose(contact.id)}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {contactName(contact)}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {contact.phones.map(formatPhone).join(" · ") ||
                          "No phone"}
                      </div>
                    </div>
                    {setParty.isPending ? (
                      <Loader2 className="size-4 animate-spin text-muted-foreground" />
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
