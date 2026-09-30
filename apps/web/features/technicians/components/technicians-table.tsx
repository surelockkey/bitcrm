"use client";

import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { TechnicianProfile } from "@bitcrm/types";
import { initials } from "@/features/users/lib";
import { formatMoney, techName, techUser } from "../lib";
import { TechnicianStatusBadge } from "./technician-status-badge";
import type { DirectoryUser } from "@/features/deals/hooks";

/**
 * Every column, in order, with the width it starts at.
 *
 * One list, read by both the `<colgroup>` and the headers. The table is
 * `table-fixed`: the chevron column used to pin itself with a `w-8`, and a
 * width class on a cell beats the column's declared width and shoves the row
 * sideways — so the width is declared here only.
 */
const COLUMNS = [
  { id: "technician", label: "Technician", width: 280, align: "" },
  { id: "department", label: "Department", width: 180, align: "" },
  { id: "status", label: "Status", width: 140, align: "" },
  { id: "labor", label: "Labor", width: 140, align: "text-right" },
  { id: "open", label: "Open", width: 56, align: "" },
] as const;

/** Starting widths, until the reader drags their own. */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.width] as const),
);

export function TechniciansTable({
  technicians,
  userMap,
}: {
  technicians: TechnicianProfile[];
  userMap: Map<string, DirectoryUser>;
}) {
  const router = useRouter();
  const { widthOf, setWidth, reset } = useColumnWidths("technicians", COLUMN_DEFAULTS);

  /** The chevron column carries no visible heading, only a name for the reader. */
  const headLabel = (id: string, label: string) =>
    id === "open" ? <span className="sr-only">{label}</span> : undefined;

  return (
    <div className="overflow-x-auto border">
      <Table className="table-fixed">
        <colgroup>
          {COLUMNS.map((c) => (
            <col key={c.id} style={{ width: widthOf(c.id) }} />
          ))}
        </colgroup>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {COLUMNS.map((c) => (
              <ResizableHead
                key={c.id}
                columnId={c.id}
                label={c.label}
                width={widthOf(c.id)}
                onResize={(px) => setWidth(c.id, px)}
                onReset={reset}
                className={c.align}
              >
                {headLabel(c.id, c.label)}
              </ResizableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {technicians.map((t) => {
            const u = techUser(t.userId, userMap);
            return (
              <TableRow
                key={t.userId}
                className="cursor-pointer"
                onClick={() => router.push(`/technicians/${t.userId}`)}
              >
                <TableCell className="overflow-hidden">
                  <div className="flex items-center gap-2.5">
                    <Avatar className="size-8">
                      <AvatarFallback className="text-xs">
                        {initials(u?.firstName, u?.lastName)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{techName(t.userId, userMap)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {u?.email ?? t.userId}
                      </div>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="truncate text-muted-foreground">{u?.department || "—"}</TableCell>
                <TableCell className="overflow-hidden">
                  <TechnicianStatusBadge status={t.status} />
                </TableCell>
                <TableCell className="truncate text-right tabular-nums text-muted-foreground">
                  {t.laborCostPerHour != null ? `${formatMoney(t.laborCostPerHour)}/hr` : "—"}
                </TableCell>
                <TableCell className="overflow-hidden">
                  <ChevronRight className="size-4 text-muted-foreground" />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
