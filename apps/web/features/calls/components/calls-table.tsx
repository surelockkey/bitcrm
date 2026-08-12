"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Mic, PhoneIncoming, PhoneOutgoing } from "lucide-react";
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
import { CallStatusBadge } from "./call-status-badge";
import { NewClientFromCallDialog } from "./new-client-from-call-dialog";

export function CallsTable({ calls }: { calls: CallRecord[] }) {
  const router = useRouter();
  // The number an unknown caller is being turned into a client for.
  const [addingFor, setAddingFor] = useState<string | null>(null);

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
            <TableRow
              key={call.callSid}
              className="cursor-pointer"
              onClick={() => router.push(`/calls/${call.callSid}`)}
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
                  <Mic className="ml-auto size-4 text-muted-foreground" />
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <NewClientFromCallDialog
        phone={addingFor}
        onClose={() => setAddingFor(null)}
      />
    </div>
  );
}
