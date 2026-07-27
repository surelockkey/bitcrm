"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Contact, Deal, User } from "@bitcrm/types";
import { contactName, formatPhone, primaryPhone, primaryEmail } from "@/features/clients/lib";
import { formatSchedule, isUrgent, scheduleRelative } from "../lib";
import { useJobTypeName } from "@/features/job-types/lib";
import { JobTagChips } from "@/features/job-tags/components/job-tag-chips";
import { TechChips } from "./assigned-techs";
import { PriorityFlag } from "./deal-badges";

export function DealsTable({
  deals,
  contactMap,
  userMap,
  onOpen,
}: {
  deals: Deal[];
  contactMap: Map<string, Contact>;
  userMap: Map<string, User>;
  onOpen: (deal: Deal) => void;
}) {
  const jobTypeName = useJobTypeName();
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16">Job&nbsp;#</TableHead>
            <TableHead>Client</TableHead>
            <TableHead>Tech</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Scheduled</TableHead>
            <TableHead>Job type</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {deals.map((d) => {
            const contact = contactMap.get(d.contactId);
            const phone = contact ? primaryPhone(contact) : undefined;
            const email = contact ? primaryEmail(contact) : undefined;
            const rel = scheduleRelative(d.scheduledDate, todayIso);
            const loc = d.address?.city
              ? `${d.address.city}${d.address.state ? `, ${d.address.state}` : ""}`
              : d.serviceArea || "—";
            return (
              <TableRow
                key={d.id}
                className="cursor-pointer align-top"
                onClick={() => onOpen(d)}
              >
                <TableCell className="font-mono text-xs text-muted-foreground">#{d.dealNumber}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{contact ? contactName(contact) : "—"}</span>
                    {isUrgent(d) ? <PriorityFlag /> : null}
                  </div>
                  {phone ? (
                    <div className="text-xs text-muted-foreground">{formatPhone(phone)}</div>
                  ) : email ? (
                    <div className="text-xs text-muted-foreground">{email}</div>
                  ) : null}
                </TableCell>
                <TableCell>
                  <TechChips techIds={d.assignedTechIds} userMap={userMap} size="xs" emptyText="—" />
                </TableCell>
                <TableCell>
                  {d.tagIds?.length ? <JobTagChips ids={d.tagIds} max={3} /> : <span className="text-muted-foreground">—</span>}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">{loc}</TableCell>
                <TableCell className="text-sm">
                  <div>{formatSchedule(d.scheduledDate, d.scheduledTimeSlot)}</div>
                  {rel ? (
                    <div
                      className={
                        rel.tone === "overdue"
                          ? "text-xs text-red-600 dark:text-red-400"
                          : rel.tone === "soon"
                            ? "text-xs text-amber-600 dark:text-amber-400"
                            : "text-xs text-muted-foreground"
                      }
                    >
                      {rel.label}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{jobTypeName(d.jobTypeId)}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
