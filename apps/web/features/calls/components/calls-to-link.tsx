"use client";

import { useState } from "react";
import { Phone, X } from "lucide-react";
import { WzButton, WzSwitch } from "@/components/workiz";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCallDetail, useCallsForParty } from "../hooks";
import {
  counterparty,
  formatCallTime,
  formatDuration,
  formatEndpoint,
  type CallRecord,
} from "../lib";

/**
 * Which calls this new job will be linked to on save.
 *
 * The call you're on is included by default and says so plainly — creating a
 * job mid-call is nearly always about that call. It can be switched off and
 * back on before saving, and earlier calls with the same client can be added.
 *
 * Workiz has no such card; it lives on our New Job page only, so it is drawn
 * with the Workiz kit like the cards around it (the green switch, the
 * outline pill, 14px ink rows in #ccc boxes).
 */
export function CallsToLink({
  callSid,
  contactId,
  selected,
  onChange,
}: {
  /** The call in progress, if the page was opened from one. */
  callSid?: string;
  /** Known client, used to offer their earlier calls. */
  contactId?: string;
  selected: string[];
  onChange: (sids: string[]) => void;
}) {
  const [picking, setPicking] = useState(false);
  const current = useCallDetail(callSid ?? "");

  const currentOn = !!callSid && selected.includes(callSid);
  const extras = selected.filter((sid) => sid !== callSid);

  const toggleCurrent = (on: boolean) => {
    if (!callSid) return;
    onChange(on ? [callSid, ...extras] : extras);
  };

  if (!callSid && extras.length === 0) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-[14px] leading-4 text-wz-strong">
          No calls attached to this job yet.
        </p>
        <WzButton variant="secondary" size="regular" onClick={() => setPicking(true)}>
          Link call
        </WzButton>
        <CallPicker
          open={picking}
          contactId={contactId}
          selected={selected}
          onClose={() => setPicking(false)}
          onPick={(sid) => onChange([...selected, sid])}
        />
      </div>
    );
  }

  const call = current.data;
  const client = call ? counterparty(call) : null;

  return (
    <div className="flex flex-col gap-2.5">
      {callSid ? (
        <div className="flex items-start justify-between gap-3 rounded-[4px] border border-input bg-white px-2.5 py-3">
          <div className="min-w-0">
            <div className="text-[14px] leading-4 font-medium text-wz-strong">
              {currentOn
                ? "This call will be linked to the job"
                : "This call won't be linked"}
            </div>
            <div className="mt-1.5 truncate text-[12px] leading-4 text-wz-label">
              {call ? (
                <>
                  {client?.name ? `${client.name} · ` : ""}
                  {formatEndpoint(client?.number)} ·{" "}
                  {call.direction === "inbound" ? "incoming" : "outgoing"}
                  {call.durationSeconds !== undefined
                    ? ` · ${formatDuration(call.durationSeconds)}`
                    : ""}
                </>
              ) : (
                "Loading the call…"
              )}
            </div>
          </div>
          <WzSwitch
            checked={currentOn}
            onCheckedChange={toggleCurrent}
            aria-label="Link this call to the job"
          />
        </div>
      ) : null}

      {extras.length > 0 ? (
        <ul className="divide-y divide-input rounded-[4px] border border-input bg-white">
          {extras.map((sid) => (
            <ExtraCallRow
              key={sid}
              sid={sid}
              onRemove={() => onChange(selected.filter((s) => s !== sid))}
            />
          ))}
        </ul>
      ) : null}

      <div>
        <WzButton variant="secondary" size="regular" onClick={() => setPicking(true)}>
          Link another call
        </WzButton>
      </div>

      <CallPicker
        open={picking}
        contactId={contactId}
        selected={selected}
        onClose={() => setPicking(false)}
        onPick={(sid) => onChange([...selected, sid])}
      />
    </div>
  );
}

function ExtraCallRow({ sid, onRemove }: { sid: string; onRemove: () => void }) {
  const { data: call } = useCallDetail(sid);
  const client = call ? counterparty(call) : null;

  return (
    <li className="flex items-center gap-3 px-2.5 py-2 text-[14px] leading-4 text-wz-strong">
      <Phone className="size-3.5 shrink-0 text-wz-label" />
      <div className="min-w-0 flex-1 truncate">
        {call ? (
          <>
            {client?.name ?? formatEndpoint(client?.number)}
            <span className="text-wz-label">
              {" · "}
              {formatCallTime(call.startedAt)}
            </span>
          </>
        ) : (
          sid
        )}
      </div>
      <button
        type="button"
        aria-label="Remove call"
        className="flex size-7 cursor-pointer items-center justify-center rounded-[4px] text-wz-text hover:bg-wz-secondary-hover"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/** Earlier calls with this client, so the job can carry its whole history. */
function CallPicker({
  open,
  contactId,
  selected,
  onClose,
  onPick,
}: {
  open: boolean;
  contactId?: string;
  selected: string[];
  onClose: () => void;
  onPick: (sid: string) => void;
}) {
  const query = useCallsForParty("contact", open ? contactId : undefined);
  const calls: CallRecord[] =
    query.data?.pages.flatMap((p) => p.data as CallRecord[]) ?? [];
  const available = calls.filter((c) => !selected.includes(c.callSid));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Link a call</DialogTitle>
          <DialogDescription>
            {contactId
              ? "Earlier calls with this client."
              : "Pick a client first — then their calls can be linked."}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 overflow-y-auto">
          {!contactId ? null : available.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No other calls with this client.
            </p>
          ) : (
            <ul className="divide-y">
              {available.map((call) => (
                <li key={call.callSid}>
                  <button
                    type="button"
                    className="flex w-full items-center justify-between gap-3 px-1 py-2.5 text-left text-sm hover:bg-accent"
                    onClick={() => {
                      onPick(call.callSid);
                      onClose();
                    }}
                  >
                    <span>
                      {call.direction === "inbound" ? "Called in" : "We called"}
                      <span className="text-muted-foreground">
                        {" · "}
                        {formatCallTime(call.startedAt)}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {formatDuration(call.durationSeconds)}
                    </span>
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
