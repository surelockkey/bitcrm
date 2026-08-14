"use client";

import Link from "next/link";
import { ExternalLink } from "lucide-react";
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
import { DEFAULT_VISIBLE, type VisibleFields } from "../fields";
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
  visibleFields = DEFAULT_VISIBLE,
}: {
  deals: Deal[];
  contactMap: Map<string, Contact>;
  userMap: Map<string, User>;
  onOpen: (deal: Deal) => void;
  visibleFields?: VisibleFields;
}) {
  const jobTypeName = useJobTypeName();
  const todayIso = new Date().toISOString().slice(0, 10);

  return (
    <div className="overflow-x-auto rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-16">Job&nbsp;#</TableHead>
            {visibleFields.client ? <TableHead>Client</TableHead> : null}
            {visibleFields.tech ? <TableHead>Tech</TableHead> : null}
            {visibleFields.tags ? <TableHead>Tags</TableHead> : null}
            {visibleFields.location ? <TableHead>Location</TableHead> : null}
            {visibleFields.scheduled ? <TableHead>Scheduled</TableHead> : null}
            {visibleFields.jobType ? <TableHead>Job type</TableHead> : null}
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
                // Left click anywhere on the row opens the quick-view drawer;
                // right click jumps straight into the job in a new tab in
                // place of the browser menu.
                onClick={() => onOpen(d)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  window.open(`/deals/${d.id}`, "_blank", "noopener,noreferrer");
                }}
              >
                <TableCell className="font-mono text-xs">
                  {/* The number doubles as the open-in-new-tab link so it's
                      reachable right next to the nav, not across the row;
                      stopPropagation keeps the row click (preview drawer)
                      from also firing. */}
                  <Link
                    href={`/deals/${d.id}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Open job #${d.dealNumber} in new tab`}
                    title="Open in new tab"
                    onClick={(e) => e.stopPropagation()}
                    // A real link keeps its native right-click menu (copy
                    // address, etc.) — don't swallow it with the row preview.
                    onContextMenu={(e) => e.stopPropagation()}
                    className="-mx-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-muted-foreground underline-offset-2 hover:bg-accent hover:text-foreground hover:underline"
                  >
                    #{d.dealNumber}
                    <ExternalLink className="size-3" />
                  </Link>
                </TableCell>
                {visibleFields.client ? (
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
                ) : null}
                {visibleFields.tech ? (
                  <TableCell>
                    <TechChips techIds={d.assignedTechIds} userMap={userMap} size="xs" emptyText="—" />
                  </TableCell>
                ) : null}
                {visibleFields.tags ? (
                  <TableCell>
                    {d.tagIds?.length ? <JobTagChips ids={d.tagIds} max={3} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                ) : null}
                {visibleFields.location ? (
                  <TableCell className="text-sm text-muted-foreground">{loc}</TableCell>
                ) : null}
                {visibleFields.scheduled ? (
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
                ) : null}
                {visibleFields.jobType ? (
                  <TableCell className="text-sm">{jobTypeName(d.jobTypeId)}</TableCell>
                ) : null}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
