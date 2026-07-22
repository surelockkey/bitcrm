"use client";

import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Contact, Deal, User } from "@bitcrm/types";
import { contactName, initials } from "@/features/clients/lib";
import { formatMoney, formatSchedule, isUrgent } from "../lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { PriorityFlag, StageBadge } from "./deal-badges";

export function DealsTable({
  deals,
  contactMap,
  userMap,
}: {
  deals: Deal[];
  contactMap: Map<string, Contact>;
  userMap: Map<string, User>;
}) {
  const router = useRouter();
  const jobTypeName = useJobTypeName();
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16">#</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Job</TableHead>
            <TableHead>Area</TableHead>
            <TableHead>Stage</TableHead>
            <TableHead>Tech</TableHead>
            <TableHead>Scheduled</TableHead>
            <TableHead className="text-right">Total</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((d) => {
            const contact = contactMap.get(d.contactId);
            const tech = d.assignedTechId ? userMap.get(d.assignedTechId) : undefined;
            const total = d.actualTotal ?? d.estimatedTotal;
            return (
              <TableRow key={d.id} className="cursor-pointer" onClick={() => router.push(`/deals/${d.id}`)}>
                <TableCell className="font-mono text-xs text-muted-foreground">#{d.dealNumber}</TableCell>
                <TableCell>
                  <span className="font-medium">{contact ? contactName(contact) : "—"}</span>
                  {isUrgent(d) ? <PriorityFlag className="ml-2" /> : null}
                </TableCell>
                <TableCell className="text-sm">{jobTypeName(d.jobTypeId)}</TableCell>
                <TableCell className="text-sm text-muted-foreground">{d.serviceArea}</TableCell>
                <TableCell><StageBadge stage={d.stage} /></TableCell>
                <TableCell>
                  {tech ? (
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <span className="grid size-5 place-items-center rounded-full bg-muted text-[9px] font-bold">
                        {initials(tech.firstName, tech.lastName)}
                      </span>
                      {tech.firstName}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {formatSchedule(d.scheduledDate, d.scheduledTimeSlot)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {typeof total === "number" ? formatMoney(total) : "—"}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
