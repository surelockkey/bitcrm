"use client";

import { useState } from "react";
import { Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { formatPhone } from "@/lib/phone";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCallsForParty } from "@/features/calls/hooks";
import { formatCallAgo, recentCallerIds } from "@/features/calls/lib";
import { useSoftphoneStore } from "../softphone-store";
import { startCall } from "../softphone-manager";
import { useNumbers } from "../numbers-hooks";

/**
 * Call this number, from a number they'll recognise.
 *
 * Sits next to each of a client's phone numbers on their record and on the
 * job, because that's where somebody decides to ring them — not the dialer,
 * which would mean copying the number across.
 *
 * Choosing our end matters: a callback from the line they last spoke to gets
 * answered, and one from an unfamiliar number gets ignored. So the picker
 * opens on the numbers this client has actually been in contact with, newest
 * first and dated, with the rest of the workspace's numbers a search away.
 */
export function CallClientButton({
  to,
  partyId,
  kind = "contact",
  className,
}: {
  /** The client's number to dial, E.164. */
  to: string;
  /** Whose call history to read for the recently-used list. */
  partyId?: string;
  kind?: "contact" | "company";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const { can } = usePermissions();
  const status = useSoftphoneStore((s) => s.status);
  const setActiveNumber = useSoftphoneStore((s) => s.setActiveNumber);

  // Both are only worth fetching once somebody means to call.
  const { data: numbers } = useNumbers(open);
  const history = useCallsForParty(kind, open && can("calls") ? partyId : undefined);

  if (!to) return null;

  const calls = history.data?.pages.flatMap((p) => p.data) ?? [];
  const recent = recentCallerIds(calls, to).slice(0, 4);
  const recentSet = new Set(recent.map((r) => r.number));
  const rest = (numbers ?? []).filter((n) => !recentSet.has(n.phoneNumber));

  const place = (from?: string) => {
    setOpen(false);
    // The manager reads the caller id off the store when it dials.
    if (from) setActiveNumber(from);
    void startCall(to);
  };

  return (
    <span className={className ? `relative ${className}` : "relative"}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Call ${formatPhone(to)}`}
        title={`Call ${formatPhone(to)}`}
        className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <Phone className="size-3.5" />
      </button>

      {open ? (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-lg border bg-popover shadow-md">
            <div className="border-b px-3 py-2">
              <p className="text-xs font-medium">Call {formatPhone(to)}</p>
              <p className="text-[11px] text-muted-foreground">
                {status === "online"
                  ? "From which of our numbers?"
                  : "Turn the phone on to place the call."}
              </p>
            </div>

            {recent.length ? (
              <ul className="border-b py-1">
                {recent.map((use) => (
                  <li key={use.number}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-accent"
                      onClick={() => place(use.number)}
                    >
                      {use.direction === "inbound" ? (
                        <PhoneIncoming className="size-3.5 shrink-0 text-muted-foreground" />
                      ) : (
                        <PhoneOutgoing className="size-3.5 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">
                          {formatPhone(use.number)}
                        </span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {use.direction === "inbound" ? "They called" : "We called"}{" "}
                          · {formatCallAgo(use.lastAt)}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <Command loop>
              <CommandInput
                autoFocus
                placeholder="Search our numbers…"
                className="h-9"
              />
              <CommandList className="max-h-48">
                <CommandEmpty>No number matches.</CommandEmpty>
                <CommandGroup
                  heading={recent.length ? "Other numbers" : "Our numbers"}
                >
                  {rest.map((n) => (
                    <CommandItem
                      key={n.sid}
                      // Both spellings, so "404555" and "+1 404-555" both hit.
                      value={`${n.friendlyName} ${n.phoneNumber} ${n.phoneNumber.replace(/\D/g, "")}`}
                      onSelect={() => place(n.phoneNumber)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs">
                          {formatPhone(n.phoneNumber)}
                        </span>
                        {n.friendlyName && n.friendlyName !== n.phoneNumber ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {n.friendlyName}
                          </span>
                        ) : null}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </div>
        </>
      ) : null}
    </span>
  );
}
