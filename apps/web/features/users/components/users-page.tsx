"use client";

import { useMemo, useState } from "react";
import { Loader2, Search, TriangleAlert, UserPlus, UsersRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { User } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useRoles, useUsers } from "../hooks";
import type { UserFilter } from "../api";
import { CreateUserSheet } from "./create-user-sheet";
import { UserDetailSheet } from "./user-detail-sheet";
import { UsersTable } from "./users-table";

function matches(u: User, q: string): boolean {
  const hay = `${u.firstName} ${u.lastName} ${u.email} ${u.department}`.toLowerCase();
  return hay.includes(q.toLowerCase());
}

export function UsersPage() {
  const { can } = usePermissions();
  const [filter, setFilter] = useState<UserFilter>({});
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<{ user: User; tab: string } | null>(
    null,
  );

  const usersQuery = useUsers(filter);
  const { data: roles } = useRoles();

  const users = useMemo(
    () => usersQuery.data?.pages.flatMap((p) => p.data) ?? [],
    [usersQuery.data],
  );
  const visible = search ? users.filter((u) => matches(u, search)) : users;

  // Keep the open detail sheet showing the freshest copy from the list.
  const currentUser = selected
    ? (users.find((u) => u.id === selected.user.id) ?? selected.user)
    : null;

  const openUser = (user: User, tab = "profile") =>
    setSelected({ user, tab });

  if (!can("users", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view users.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Manage accounts, roles, and access.
          </p>
        </div>
        {can("users", "create") ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5 px-3.5"
            onClick={() => setCreateOpen(true)}
          >
            <UserPlus className="size-4" />
            New user
          </Button>
        ) : null}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name, email, department"
            className="h-9 pl-8"
          />
        </div>

        <Select
          value={filter.roleId ?? "all"}
          onValueChange={(v) => setFilter(v === "all" ? {} : { roleId: v })}
        >
          <SelectTrigger className="h-9 w-40">
            <SelectValue placeholder="Role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            {(roles ?? []).map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filter.status ?? "all"}
          onValueChange={(v) => setFilter(v === "all" ? {} : { status: v })}
        >
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        <span className="ml-auto text-sm text-muted-foreground">
          {visible.length} {visible.length === 1 ? "user" : "users"}
        </span>
      </div>

      {/* Body */}
      <div className="flex-1 px-6 pb-6">
        {usersQuery.isLoading ? (
          <TableSkeleton />
        ) : usersQuery.isError ? (
          <ErrorState onRetry={() => usersQuery.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState filtered={users.length > 0 || !!search} />
        ) : (
          <>
            <UsersTable users={visible} roles={roles ?? []} onOpen={openUser} />
            {usersQuery.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => usersQuery.fetchNextPage()}
                  disabled={usersQuery.isFetchingNextPage}
                  className="gap-1.5"
                >
                  {usersQuery.isFetchingNextPage ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : null}
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <CreateUserSheet open={createOpen} onOpenChange={setCreateOpen} />
      {currentUser ? (
        <UserDetailSheet
          key={currentUser.id}
          user={currentUser}
          defaultTab={selected?.tab}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-8 rounded-full" />
          <Skeleton className="h-4 w-48" />
          <Skeleton className="ml-auto h-4 w-24" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <UsersRound className="size-6" />
      </div>
      <div>
        <div className="font-medium">
          {filtered ? "No users match" : "No users yet"}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered
            ? "Try clearing filters or search."
            : "Invite your first teammate to get started."}
        </p>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="font-medium">Couldn&apos;t load users</div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
