"use client";

import { Fragment, useState } from "react";
import { PhoneIncoming, PhoneOutgoing, Play, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  callParty,
  formatCallTime,
  formatDuration,
  type CallRecord,
} from "../lib";
import { CallPartyCell } from "./call-party-cell";
import { CallQuickView } from "./call-quick-view";
import { CallStatusBadge } from "./call-status-badge";
import { NewClientFromCallDialog } from "./new-client-from-call-dialog";
import { RecordingPreview } from "./recording-preview";

export function CallsTable({ calls }: { calls: CallRecord[] }) {
  // The number an unknown caller is being turned into a client for.
  const [addingFor, setAddingFor] = useState<string | null>(null);
  // The call whose recording is playing inline; one preview at a time.
  const [previewSid, setPreviewSid] = useState<string | null>(null);
  // The call open in the side preview panel.
  const [quickViewSid, setQuickViewSid] = useState<string | null>(null);

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>From</TableHead>
            <TableHead>To</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Started</TableHead>
            <TableHead className="text-right">Duration</TableHead>
            <TableHead className="w-10 text-right">Rec</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {calls.map((call) => (
            <Fragment key={call.callSid}>
              <TableRow
                className="cursor-pointer"
                // Left click opens the side preview; right click jumps
                // straight into the call page in a new tab, like the job list.
                onClick={() => setQuickViewSid(call.callSid)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  window.open(
                    `/calls/${call.callSid}`,
                    "_blank",
                    "noopener,noreferrer",
                  );
                }}
              >
                <TableCell>
                  {call.direction === "inbound" ? (
                    <PhoneIncoming className="size-4 text-muted-foreground" />
                  ) : (
                    <PhoneOutgoing className="size-4 text-muted-foreground" />
                  )}
                </TableCell>
                <TableCell>
                  <CallPartyCell
                    party={callParty(call, "from")}
                    onAddClient={setAddingFor}
                  />
                </TableCell>
                <TableCell>
                  <CallPartyCell
                    party={callParty(call, "to")}
                    onAddClient={setAddingFor}
                  />
                </TableCell>
                <TableCell>
                  <CallStatusBadge status={call.status} />
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {formatCallTime(call.startedAt)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatDuration(call.durationSeconds)}
                </TableCell>
                <TableCell className="text-right">
                  {call.recordingSid ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-7"
                      aria-label={
                        previewSid === call.callSid
                          ? "Close player"
                          : "Play recording"
                      }
                      onClick={(e) => {
                        // The row click opens the call page; this stays put.
                        e.stopPropagation();
                        setPreviewSid((sid) =>
                          sid === call.callSid ? null : call.callSid,
                        );
                      }}
                    >
                      {previewSid === call.callSid ? (
                        <X className="size-4" />
                      ) : (
                        <Play className="size-4" />
                      )}
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
              {previewSid === call.callSid ? (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={7} className="bg-muted/30 py-2">
                    <RecordingPreview callSid={call.callSid} />
                  </TableCell>
                </TableRow>
              ) : null}
            </Fragment>
          ))}
        </TableBody>
      </Table>

      <CallQuickView
        callSid={quickViewSid}
        open={!!quickViewSid}
        onOpenChange={(open) => !open && setQuickViewSid(null)}
      />

      <NewClientFromCallDialog
        phone={addingFor}
        onClose={() => setAddingFor(null)}
      />
    </div>
  );
}
