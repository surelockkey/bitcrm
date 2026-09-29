"use client";

import { useRouter } from "next/navigation";
import { ChevronRight, Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ResizableHead } from "@/components/ui/resizable-head";
import { useColumnWidths } from "@/lib/table/use-column-widths";
import { Skeleton } from "@/components/ui/skeleton";
import type { Role } from "@bitcrm/types";
import { dominantScope, roleSwatch, scopeLabel, sortRolesByPriority } from "../lib";
import { RoleTypeBadge } from "./role-type-badge";

/**
 * Every column, in order, with the width it starts at.
 *
 * One list, read by both the `<colgroup>` and the headers. The table is
 * `table-fixed`: the chevron column used to pin itself with a `w-8`, and a
 * width class on a cell beats the column's declared width and shoves the row
 * sideways — so the width is declared here only.
 */
const COLUMNS = [
  { id: "role", label: "Role", width: 280, align: "" },
  { id: "type", label: "Type", width: 150, align: "" },
  { id: "priority", label: "Priority", width: 180, align: "" },
  { id: "scope", label: "Default scope", width: 180, align: "" },
  { id: "members", label: "Members", width: 120, align: "text-right" },
  { id: "open", label: "Open", width: 56, align: "" },
] as const;

/** Starting widths, until the reader drags their own. */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.width] as const),
);

export function RolesTable({
  roles,
  memberCounts,
}: {
  roles: Role[];
  memberCounts: Record<string, number | undefined>;
}) {
  const router = useRouter();
  const ordered = sortRolesByPriority(roles);
  const max = ordered[0]?.priority || 100;
  const { widthOf, setWidth, reset } = useColumnWidths("roles", COLUMN_DEFAULTS);

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
          {ordered.map((r) => {
            const count = memberCounts[r.id];
            return (
              <TableRow
                key={r.id}
                className="cursor-pointer"
                onClick={() => router.push(`/admin/roles/${r.id}`)}
              >
                <TableCell className="overflow-hidden">
                  <div className="flex items-center gap-2.5">
                    <span
                      className="size-2.5 flex-none rounded-[3px]"
                      style={{ background: roleSwatch(r.id) }}
                    />
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.name}</div>
                      {r.description ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {r.description}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="overflow-hidden">
                  <RoleTypeBadge role={r} />
                </TableCell>
                <TableCell className="overflow-hidden">
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 flex-none font-mono text-sm tabular-nums text-muted-foreground">
                      {r.priority}
                    </span>
                    <span className="h-1.5 w-16 flex-none overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-brand/70"
                        style={{ width: `${Math.round((r.priority / max) * 100)}%` }}
                      />
                    </span>
                  </div>
                </TableCell>
                <TableCell className="truncate text-muted-foreground">
                  {scopeLabel(dominantScope(r.dataScope))}
                </TableCell>
                <TableCell className="overflow-hidden text-right tabular-nums">
                  {count === undefined ? (
                    <Skeleton className="ml-auto h-4 w-6" />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Users className="size-3.5" />
                      {count}
                    </span>
                  )}
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
