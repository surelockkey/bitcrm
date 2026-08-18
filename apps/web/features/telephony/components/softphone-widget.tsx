"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRightLeft,
  GripHorizontal,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { useActiveCall } from "@/features/calls/hooks";
import { counterparty, isLive } from "@/features/calls/lib";
import { onMessage } from "../tab-coordinator";
import { useTabOwner } from "../use-tab-owner";
import { CallJobActions } from "@/features/calls/components/call-job-actions";
import { TransferPanel, type TransferIntent } from "./transfer-panel";
import { DialerDirectory } from "./dialer-directory";
import { formatPhone } from "@/lib/phone";
import { useSoftphoneStore } from "../softphone-store";
import { useNumbers } from "../numbers-hooks";
import { CallerIdPicker } from "./caller-id-picker";
import { takeCallHere } from "../softphone-manager";
import { useCallTimer } from "../use-call-timer";
import {
  acceptIncoming,
  hangup,
  rejectIncoming,
  sendDigit,
  startCall,
  toggleMute,
} from "../softphone-manager";

const WIDGET_W = 288; // w-72
const DIGITS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

const STATUS_LABEL: Record<string, string> = {
  offline: "Offline",
  connecting: "Connecting…",
  online: "Online",
  error: "Error",
};

export function SoftphoneWidget() {
  const dialerOpen = useSoftphoneStore((s) => s.dialerOpen);
  const setDialerOpen = useSoftphoneStore((s) => s.setDialerOpen);
  const position = useSoftphoneStore((s) => s.position);
  const setPosition = useSoftphoneStore((s) => s.setPosition);
  const callState = useSoftphoneStore((s) => s.callState);
  const call = useSoftphoneStore((s) => s.call);
  const muted = useSoftphoneStore((s) => s.muted);
  const status = useSoftphoneStore((s) => s.status);
  const errorMessage = useSoftphoneStore((s) => s.errorMessage);
  const phoneOn = useSoftphoneStore((s) => s.phoneOn);
  const setPhoneOn = useSoftphoneStore((s) => s.setPhoneOn);
  const activeNumber = useSoftphoneStore((s) => s.activeNumber);
  const setActiveNumber = useSoftphoneStore((s) => s.setActiveNumber);

  const [entry, setEntry] = useState("");
  const timer = useCallTimer(call?.startedAt);

  const isOwner = useTabOwner();
  const inCall = callState !== "idle";
  // What the server says this user is on — true in every tab, not just the one
  // holding the audio. A follower has no Device and no local call state, so
  // this is the only thing that knows a call is happening at all.
  // Kept on during a call too, so hanging up here can name the call it ended.
  const { data: serverCall } = useActiveCall(true);
  const qc = useQueryClient();

  // Hanging up is instant locally but takes a moment to reach the server, so
  // for a second or two `/calls/active` still reports the call this tab just
  // ended — which read as "your call is in another tab, want it back?".
  // Remembering the sid we hung up on is exact where a time window would be a
  // guess; a call that ends any other way is caught by the liveness check.
  const [endedSid, setEndedSid] = useState<string | null>(null);

  // When another tab is the one that hung up, its broadcast gets us there
  // without waiting out the poll.
  useEffect(
    () =>
      onMessage((message) => {
        if (message.type === "call-changed") {
          void qc.invalidateQueries({ queryKey: queryKeys.calls.active() });
        }
      }),
    [qc],
  );

  const elsewhere =
    !inCall &&
    !!serverCall?.callSid &&
    isLive(serverCall) &&
    serverCall.callSid !== endedSid;
  const elsewhereParty = serverCall ? counterparty(serverCall) : null;
  const elsewhereTimer = useCallTimer(serverCall?.answeredAt);
  const [taking, setTaking] = useState(false);
  // A live call forces the panel open even if the user "closed" it.
  const visible = dialerOpen || inCall;

  // Caller-id choices — only fetched while the softphone is in use.
  const { data: numbers } = useNumbers(phoneOn || visible);
  useEffect(() => {
    if (!numbers || numbers.length === 0) return;
    const stillValid = numbers.some((n) => n.phoneNumber === activeNumber);
    if (!activeNumber || !stillValid) {
      setActiveNumber(numbers[0].phoneNumber);
    }
  }, [numbers, activeNumber, setActiveNumber]);

  // ---- dragging ----
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      drag.current = { dx: e.clientX - position.x, dy: e.clientY - position.y };
    },
    [position.x, position.y],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drag.current) return;
      const maxX = window.innerWidth - WIDGET_W - 8;
      const maxY = window.innerHeight - 80;
      setPosition({
        x: Math.min(Math.max(8, e.clientX - drag.current.dx), Math.max(8, maxX)),
        y: Math.min(Math.max(8, e.clientY - drag.current.dy), Math.max(8, maxY)),
      });
    },
    [setPosition],
  );
  const onPointerUp = useCallback((e: React.PointerEvent) => {
    drag.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  // Long-press "0" → "+" state. Declared before any early return (Rules of Hooks).
  const zeroTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zeroLongPressed = useRef(false);
  /** Which sub-panel is open over the keypad, if any. */
  const [panel, setPanel] = useState<TransferIntent | null>(null);
  // The record behind this call: the browser knows its own leg, the server
  // knows which call that leg belongs to.
  const activeCall = useActiveCall(callState !== "idle");

  if (!visible) return null;

  const otherParty = call
    ? call.contactName ?? formatPhone(call.number)
    : "";

  const handleDigit = (d: string) => {
    if (callState === "active") sendDigit(d);
    // First keypad digit auto-starts the number with "+" (E.164). "*"/"#" don't.
    else setEntry((v) => (v === "" && /\d/.test(d) ? "+" + d : v + d));
  };

  // "+" only makes sense as the E.164 country-code prefix, at the very start.
  const addPlus = () => setEntry((v) => (v.startsWith("+") ? v : "+" + v));

  // Real-phone behaviour: long-press "0" inserts "+" (for international dialing).
  const onZeroDown = () => {
    zeroLongPressed.current = false;
    if (callState === "active") return; // during a call "0" is DTMF only
    zeroTimer.current = setTimeout(() => {
      zeroLongPressed.current = true;
      addPlus();
    }, 450);
  };
  const onZeroUp = () => {
    if (zeroTimer.current) {
      clearTimeout(zeroTimer.current);
      zeroTimer.current = null;
    }
    if (!zeroLongPressed.current) handleDigit("0");
  };
  const onZeroCancel = () => {
    if (zeroTimer.current) {
      clearTimeout(zeroTimer.current);
      zeroTimer.current = null;
    }
  };

  return (
    <div
      className="fixed z-50 w-72 select-none rounded-xl border bg-background shadow-2xl"
      style={{ left: position.x, top: position.y }}
      role="dialog"
      aria-label="Softphone"
    >
      {/* Drag handle / header */}
      <div
        className="flex cursor-grab items-center gap-2 rounded-t-xl border-b bg-muted/40 px-3 py-2 active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <GripHorizontal className="size-4 text-muted-foreground" />
        <span className="text-sm font-medium">Phone</span>
        <button
          type="button"
          className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted"
          onClick={() => setDialerOpen(false)}
          disabled={inCall}
          aria-label="Close dialer"
        >
          <X className="size-4" />
        </button>
      </div>

      {/* On/off + status */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="flex items-center gap-2 text-xs">
          <span
            className={cn(
              "size-2 rounded-full",
              status === "online" && "bg-emerald-500",
              status === "connecting" && "bg-amber-500 animate-pulse",
              status === "error" && "bg-red-500",
              status === "offline" && "bg-muted-foreground/40",
            )}
          />
          <span
            className={cn(
              "font-medium",
              status === "error" && "text-red-500",
            )}
          >
            {STATUS_LABEL[status] ?? status}
          </span>
          {/* Only one tab registers a Device. Saying which one is why an idle
              dialer here isn't a bug. */}
          {!isOwner && phoneOn ? (
            <span className="text-[10px] text-muted-foreground">
              · phone is in another tab
            </span>
          ) : null}
        </span>
        <Switch
          checked={phoneOn}
          onCheckedChange={setPhoneOn}
          disabled={inCall}
          aria-label="Turn phone on or off"
        />
      </div>

      {errorMessage && status === "error" ? (
        <p className="border-b px-3 py-1.5 text-center text-xs text-red-500">
          {errorMessage}
        </p>
      ) : null}

      {elsewhere ? (
        <div className="space-y-3 p-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-center">
            <div className="truncate text-base font-semibold">
              {elsewhereParty?.name ?? formatPhone(elsewhereParty?.number ?? "")}
            </div>
            <div className="text-xs text-muted-foreground">
              {serverCall?.answeredAt ? elsewhereTimer : "connecting"} · audio is
              in another tab
            </div>
          </div>

          {/* The audio can't be copied here — but the call is a conference, so
              this tab can join it and the other tab's leg is dropped after. */}
          <Button
            variant="brand"
            className="w-full gap-1.5"
            disabled={taking}
            onClick={() => {
              setTaking(true);
              void takeCallHere(
                serverCall!.callSid,
                elsewhereParty?.name ?? elsewhereParty?.number,
              ).finally(() => setTaking(false));
            }}
          >
            {taking ? <Loader2 className="size-4 animate-spin" /> : null}
            Take the call in this tab
          </Button>

          <CallJobActions call={serverCall ?? null} />

          <p className="text-center text-[11px] text-muted-foreground">
            Linking to a job works from here without moving the call.
          </p>
        </div>
      ) : !phoneOn && !inCall ? (
        <div className="flex flex-col items-center gap-1 px-3 py-8 text-center">
          <PhoneOff className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">Phone is off</p>
          <p className="text-xs text-muted-foreground">
            Turn it on to make and receive calls.
          </p>
        </div>
      ) : (
      <div className="space-y-3 p-3">
        {/* Call status area */}
        {inCall ? (
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <div className="truncate text-base font-semibold">{otherParty}</div>
            <div className="text-xs text-muted-foreground">
              {callState === "incoming" && "Incoming call…"}
              {callState === "connecting" &&
                (call?.monitor ? "Joining call…" : "Calling…")}
              {callState === "active" &&
                (call?.monitor
                  ? `${call.monitor === "listen" ? "Listening" : "Joined"} · ${timer}`
                  : timer)}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {numbers && numbers.length > 0 ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="shrink-0">From</span>
                <CallerIdPicker
                  numbers={numbers}
                  value={activeNumber ?? undefined}
                  onChange={setActiveNumber}
                />
              </div>
            ) : null}
            <Input
              value={entry}
              onChange={(e) => {
                // Auto-prefix "+" once the user starts typing digits (E.164).
                const raw = e.target.value;
                setEntry(
                  raw && !raw.startsWith("+") && /\d/.test(raw[0])
                    ? "+" + raw
                    : raw,
                );
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && entry) startCall(entry);
              }}
              placeholder="Name or number"
              inputMode="tel"
              className="text-center text-lg tracking-wide"
            />
            {/* Who you might mean, as you type — clients, company lines and
                teammates' own phones. */}
            <DialerDirectory query={entry} onPick={setEntry} />
          </div>
        )}

        {/* Dialpad (hidden while a call is merely ringing/connecting) */}
        {callState !== "incoming" && callState !== "connecting" ? (
          <div className="grid grid-cols-3 gap-1.5">
            {DIGITS.map((d) =>
              d === "0" ? (
                <Button
                  key="0"
                  type="button"
                  variant="outline"
                  className="flex h-11 flex-col gap-0 text-lg font-medium leading-none"
                  onPointerDown={onZeroDown}
                  onPointerUp={onZeroUp}
                  onPointerLeave={onZeroCancel}
                >
                  0
                  <span className="text-[10px] leading-none text-muted-foreground">
                    +
                  </span>
                </Button>
              ) : (
                <Button
                  key={d}
                  type="button"
                  variant="outline"
                  className="h-11 text-lg font-medium"
                  onClick={() => handleDigit(d)}
                >
                  {d}
                </Button>
              ),
            )}
          </div>
        ) : null}

        {/* Action row */}
        {callState === "incoming" ? (
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="destructive"
              onClick={rejectIncoming}
            >
              <PhoneOff className="size-4" /> Decline
            </Button>
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              onClick={acceptIncoming}
            >
              <Phone className="size-4" /> Accept
            </Button>
          </div>
        ) : inCall ? (
          panel ? (
            <TransferPanel
              callSid={activeCall.data?.callSid as string}
              intent={panel}
              onClose={() => setPanel(null)}
            />
          ) : (
            <div className="flex flex-col gap-2">
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={muted ? "secondary" : "outline"}
                  onClick={toggleMute}
                  disabled={callState !== "active"}
                >
                  {muted ? <MicOff className="size-4" /> : <Mic className="size-4" />}
                  {muted ? "Unmute" : "Mute"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setEndedSid(serverCall?.callSid ?? null);
                    hangup();
                  }}
                >
                  <PhoneOff className="size-4" /> Hang up
                </Button>
              </div>
              {/* Handing over or pulling someone in both need the call record,
                  which the server resolves — the browser only knows its own leg. */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!activeCall.data?.callSid || callState !== "active"}
                  onClick={() => setPanel("add")}
                >
                  <UserPlus className="size-3.5" /> Add
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!activeCall.data?.callSid || callState !== "active"}
                  onClick={() => setPanel("transfer")}
                >
                  <ArrowRightLeft className="size-3.5" /> Transfer
                </Button>
              </div>
              <CallJobActions call={activeCall.data ?? null} />
            </div>
          )
        ) : (
          <div className="grid grid-cols-1 gap-2">
            <Button
              type="button"
              className="bg-emerald-600 text-white hover:bg-emerald-700"
              disabled={!entry || status === "offline"}
              onClick={() => startCall(entry)}
            >
              <Phone className="size-4" /> Call
            </Button>
            {entry ? (
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setEntry((v) => v.slice(0, -1))}
              >
                ⌫ Delete
              </button>
            ) : null}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
