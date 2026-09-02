"use client";

import { useState } from "react";
import {
  Loader2,
  Laptop,
  Phone,
  PhoneIncoming,
  PhoneOutgoing,
  Smartphone,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api/errors";
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
import { startCall, startBridgedCall } from "../softphone-manager";
import { startBridge } from "../api";
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
  dealId,
  contactId,
  phoneIndex,
  variant = "icon",
}: {
  /** The client's number to dial, E.164. Empty when it is masked from us. */
  to: string;
  /** Whose call history to read for the recently-used list. */
  partyId?: string;
  kind?: "contact" | "company";
  className?: string;
  /**
   * With a job in scope the call goes through the MASKED bridge: the server is
   * told which job and which client, resolves the number itself, and dials
   * both ends. Nothing here ever needs — or is given — the digits.
   *
   * Without one (a contact or company record, where there is no job to
   * authorise a technician against) the old caller-id picker still applies.
   */
  dealId?: string;
  contactId?: string;
  phoneIndex?: number;
  /**
   * `icon` is the office's density: a bare glyph beside one of many numbers on
   * a contact record, where a labelled button per row would be noise.
   *
   * `prominent` is the job page. A technician there is not scanning a list —
   * they are looking for the one way to reach the client, usually on a phone,
   * usually standing outside somebody's house, and often the number itself is
   * masked so this button is the only route. A 28px ghost glyph reads as
   * decoration in that context; this one says what it does.
   */
  variant?: "icon" | "prominent";
}) {
  const [open, setOpen] = useState(false);
  const [placing, setPlacing] = useState(false);
  const { can } = usePermissions();
  const status = useSoftphoneStore((s) => s.status);
  const setActiveNumber = useSoftphoneStore((s) => s.setActiveNumber);

  // Both are only worth fetching once somebody means to call.
  // On the masked path the picker never opens — the caller id belongs to the
  // job's market, not to the person placing the call — so neither of these is
  // ever needed, and fetching them would be pure waste on the job page.
  const masked = Boolean(dealId && contactId);
  const { data: numbers } = useNumbers(open && !masked);
  const history = useCallsForParty(
    kind,
    open && !masked && can("calls") ? partyId : undefined,
  );

  // A masked viewer has no number to render, so `to` is empty — but the button
  // is the only way left to reach the client and must survive that.
  if (!to && !masked) return null;

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

  /**
   * The masked path. The caller id is not ours to choose here — it belongs to
   * the job's market — but WHICH PHONE RINGS is the caller's to choose, and
   * only they know: presence guesses it wrong exactly when it matters, with
   * the app open on a laptop in the van and the phone in their hand.
   */
  const placeMasked = async (via: "cell" | "softphone") => {
    setOpen(false);
    // Two taps would place two calls, and the second would ring a client who
    // is already mid-conversation with the first.
    if (placing) return;
    setPlacing(true);
    try {
      const bridge = await startBridge({
        dealId: dealId!,
        contactId: contactId!,
        ...(phoneIndex === undefined ? {} : { phoneIndex }),
        via,
      });
      if (bridge.mode === "softphone") {
        // The dialer opens on screen, which says everything a toast would.
        await startBridgedCall(bridge.bridgeId, bridge.clientName);
      } else {
        // Their own handset rings first, within seconds, from a number they do
        // not recognise. Unwarned, they decline it — and the call they just
        // asked for never happens.
        toast.success(
          bridge.clientName
            ? `Answer your phone — we'll connect ${bridge.clientName}`
            : "Answer your phone — we'll connect the client",
        );
      }
    } catch (error) {
      // Never silently: reaching the client IS the job, and the server's
      // refusals are already written for the person holding the phone
      // ("No phone number on file for you — add one in your profile…").
      toast.error(getApiErrorMessage(error));
    } finally {
      setPlacing(false);
    }
  };

  // Masked is a different action from the plain one — the system stands
  // between the two people — so it says so rather than looking identical.
  const title = masked
    ? "Call the client without showing either number"
    : to
      ? `Call ${formatPhone(to)}`
      : "Call client";
  // The number stays in the accessible name wherever we have it, so a screen
  // reader announces which line is about to ring even when the face of the
  // button only has room for a verb.
  const label = placing ? "Calling…" : to ? `Call ${formatPhone(to)}` : "Call client";

  return (
    <span className={className ? `relative inline-flex ${className}` : "relative inline-flex"}>
      {variant === "prominent" ? (
        <Button
          type="button"
          variant="brand"
          size="lg"
          onClick={() => setOpen((o) => !o)}
          disabled={placing}
          aria-expanded={open}
          aria-busy={placing || undefined}
          aria-label={label}
          title={title}
        >
          {placing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Phone className="size-4" />
          )}
          {placing ? "Calling…" : masked ? "Call client" : "Call"}
        </Button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-busy={placing || undefined}
          aria-label={label}
          title={title}
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          {placing ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : (
            <Phone className="size-3.5" />
          )}
        </button>
      )}

      {open && masked ? (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          {/* Two ways to reach the same conference. Neither shows a number to
              anybody, and neither asks the technician to key anything. */}
          <div className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-md">
            <div className="border-b px-3 py-2">
              <p className="text-xs font-medium">Call the client</p>
              <p className="text-[11px] text-muted-foreground">
                Neither of you sees the other&apos;s number.
              </p>
            </div>
            <ul className="py-1">
              <li>
                <button
                  type="button"
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent"
                  onClick={() => void placeMasked("cell")}
                >
                  <Smartphone className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">My phone</span>
                    <span className="block text-[11px] text-muted-foreground">
                      We ring you, then the client
                    </span>
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  disabled={status !== "online"}
                  className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent"
                  onClick={() => void placeMasked("softphone")}
                >
                  <Laptop className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-medium">This browser</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {status === "online"
                        ? "Talk through your computer"
                        : "Turn the phone on to use this"}
                    </span>
                  </span>
                </button>
              </li>
            </ul>
          </div>
        </>
      ) : null}

      {open && !masked ? (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-10 cursor-default"
            onClick={() => setOpen(false)}
          />
          {/* Drops straight under the button, aligned to its left edge, and
              never wider than the viewport on a narrow card. */}
          <div className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border bg-popover shadow-md">
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
