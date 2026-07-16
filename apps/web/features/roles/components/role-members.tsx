"use client";

import Link from "next/link";
import { ArrowUpRight, UsersRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { initials } from "@/features/users/lib";
import { UserStatusBadge } from "@/features/users/components/status-badge";
import { useRoleMembers } from "../hooks";

export function RoleMembers({ roleId }: { roleId: string }) {
  const { data: members, isLoading, isError } = useRoleMembers(roleId);

  if (isLoading) {
    return (
      <div className="space-y-2 rounded-lg border p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-48" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        Couldn&apos;t load members.
      </p>
    );
  }

  const list = members ?? [];
  if (list.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-12 text-center">
        <UsersRound className="size-6 text-muted-foreground" />
        <div className="text-sm font-medium">No one has this role</div>
        <p className="max-w-xs text-xs text-muted-foreground">
          Assign it to a user from the Users page.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {list.length} {list.length === 1 ? "user holds" : "users hold"} this role
        </span>
        <Button asChild variant="outline" size="sm" className="gap-1.5">
          <Link href="/admin/users">
            Manage in Users
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </div>
      <div className="divide-y rounded-lg border">
        {list.map((u) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar className="size-8">
              <AvatarFallback className="text-xs">
                {initials(u.firstName, u.lastName)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium">
                {u.firstName} {u.lastName}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {u.email}
                {u.department ? ` · ${u.department}` : ""}
              </div>
            </div>
            <div className="ml-auto">
              <UserStatusBadge status={u.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
