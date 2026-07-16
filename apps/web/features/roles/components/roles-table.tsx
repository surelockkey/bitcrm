"use client";

import { useRouter } from "next/navigation";
import { ChevronRight, Users } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { Role } from "@bitcrm/types";
import { dominantScope, roleSwatch, scopeLabel, sortRolesByPriority } from "../lib";
import { RoleTypeBadge } from "./role-type-badge";

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

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Role</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Default scope</TableHead>
            <TableHead className="text-right">Members</TableHead>
            <TableHead className="w-8" />
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
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span
                      className="size-2.5 flex-none rounded-[3px]"
                      style={{ background: roleSwatch(r.id) }}
                    />
                    <div className="min-w-0">
                      <div className="font-medium">{r.name}</div>
                      {r.description ? (
                        <div className="truncate text-xs text-muted-foreground">
                          {r.description}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <RoleTypeBadge role={r} />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 font-mono text-sm tabular-nums text-muted-foreground">
                      {r.priority}
                    </span>
                    <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full bg-brand/70"
                        style={{ width: `${Math.round((r.priority / max) * 100)}%` }}
                      />
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {scopeLabel(dominantScope(r.dataScope))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {count === undefined ? (
                    <Skeleton className="ml-auto h-4 w-6" />
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Users className="size-3.5" />
                      {count}
                    </span>
                  )}
                </TableCell>
                <TableCell>
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
