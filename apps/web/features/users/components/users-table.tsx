"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import type { User, Role } from "@bitcrm/types";
import { initials, formatDate, roleName } from "../lib";
import { overrideSummary } from "../overrides";
import { UserStatusBadge } from "./status-badge";
import { UserRowActions } from "./user-row-actions";

export function UsersTable({
  users,
  roles,
  onOpen,
}: {
  users: User[];
  roles: Role[];
  onOpen: (u: User, tab?: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Department</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Added</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {users.map((u) => (
            <TableRow
              key={u.id}
              className="cursor-pointer"
              onClick={() => onOpen(u)}
            >
              <TableCell>
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
              <TableCell>
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
              <TableCell className="text-muted-foreground">
                {u.department || "—"}
              </TableCell>
              <TableCell>
                <UserStatusBadge status={u.status} />
              </TableCell>
              <TableCell className="text-muted-foreground tabular-nums">
                {formatDate(u.createdAt)}
              </TableCell>
              <TableCell
                className="text-right"
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
