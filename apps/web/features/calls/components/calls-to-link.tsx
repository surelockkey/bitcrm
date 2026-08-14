"use client";

import { useState } from "react";
import { Link2, Phone, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
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
        <p className="text-sm text-muted-foreground">
          No calls attached to this job yet.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setPicking(true)}
        >
          <Link2 className="size-3.5" /> Link call
        </Button>
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
    <div className="space-y-3">
      {callSid ? (
        <div
          className={
            currentOn
              ? "flex items-start justify-between gap-3 rounded-lg border border-brand/40 bg-brand/5 p-3"
              : "flex items-start justify-between gap-3 rounded-lg border border-dashed p-3"
          }
        >
          <div className="min-w-0">
            <div className="text-sm font-medium">
              {currentOn
                ? "This call will be linked to the job"
                : "This call won't be linked"}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
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
          <Switch
            checked={currentOn}
            onCheckedChange={toggleCurrent}
            aria-label="Link this call to the job"
          />
        </div>
      ) : null}

      {extras.length > 0 ? (
        <ul className="divide-y rounded-lg border">
          {extras.map((sid) => (
            <ExtraCallRow
              key={sid}
              sid={sid}
              onRemove={() => onChange(selected.filter((s) => s !== sid))}
            />
          ))}
        </ul>
      ) : null}

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setPicking(true)}
      >
        <Link2 className="size-3.5" /> Link another call
      </Button>

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
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <Phone className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 truncate">
        {call ? (
          <>
            {client?.name ?? formatEndpoint(client?.number)}
            <span className="text-muted-foreground">
              {" · "}
              {formatCallTime(call.startedAt)}
            </span>
          </>
        ) : (
          sid
        )}
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="size-7 p-0"
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
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
