"use client";

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
import { Badge } from "@/components/ui/badge";
import type { User, Role } from "@bitcrm/types";
import { initials, formatDate, roleName } from "../lib";
import { overrideSummary } from "../overrides";
import { UserStatusBadge } from "./status-badge";
import { UserRowActions } from "./user-row-actions";

/**
 * Every column, in order, with the width it starts at.
 *
 * One list, read by both the `<colgroup>` and the headers. The table is
 * `table-fixed`: the row-actions column used to hold itself open with a
 * `w-10`, and a width class on a cell beats the column's declared width and
 * drags the whole row off its grid — so the width lives here and nowhere
 * else.
 */
const COLUMNS = [
  { id: "user", label: "User", width: 280 },
  { id: "role", label: "Role", width: 200 },
  { id: "department", label: "Department", width: 160 },
  { id: "status", label: "Status", width: 130 },
  { id: "added", label: "Added", width: 130 },
  { id: "actions", label: "Actions", width: 56 },
] as const;

/** Starting widths, until the reader drags their own. */
const COLUMN_DEFAULTS: Record<string, number> = Object.fromEntries(
  COLUMNS.map((c) => [c.id, c.width] as const),
);

export function UsersTable({
  users,
  roles,
  onOpen,
}: {
  users: User[];
  roles: Role[];
  onOpen: (u: User, tab?: string) => void;
}) {
  const { widthOf, setWidth, reset } = useColumnWidths("users", COLUMN_DEFAULTS);

  /** The actions column carries no visible heading, only a name for the reader. */
  const headLabel = (id: string, label: string) =>
    id === "actions" ? <span className="sr-only">{label}</span> : undefined;

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
              >
                {headLabel(c.id, c.label)}
              </ResizableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow
              key={u.id}
              className="cursor-pointer"
              onClick={() => onOpen(u)}
            >
              <TableCell className="overflow-hidden">
                <div className="flex items-center gap-2.5">
                  <Avatar className="size-8">
                    <AvatarFallback className="text-xs">
                      {initials(u.firstName, u.lastName)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="truncate font-medium">
                      {u.firstName} {u.lastName}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {u.email}
                    </div>
                  </div>
                </div>
              </TableCell>
              <TableCell className="overflow-hidden">
                <span className="inline-flex items-center gap-1.5">
                  <Badge variant="secondary" className="font-normal">
                    {roleName(u.roleId, roles)}
                  </Badge>
                  {overrideSummary(u.permissionOverrides).any ? (
                    <Badge
                      variant="outline"
                      className="text-[10px]"
                      title="Has permission overrides"
                    >
                      custom
                    </Badge>
                  ) : null}
                </span>
              </TableCell>
              <TableCell className="truncate text-muted-foreground">
                {u.department || "—"}
              </TableCell>
              <TableCell className="overflow-hidden">
                <UserStatusBadge status={u.status} />
              </TableCell>
              <TableCell className="truncate text-muted-foreground tabular-nums">
                {formatDate(u.createdAt)}
              </TableCell>
              <TableCell
                className="overflow-hidden text-right"
                onClick={(e) => e.stopPropagation()}
              >
                <UserRowActions user={u} onOpen={onOpen} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
