"use client";

import { useMemo, useState } from "react";
import { Search, ShieldCheck, ShieldPlus, TriangleAlert } from "lucide-react";
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
import type { Role } from "@bitcrm/types";
import { useRoles, useRoleMemberCounts } from "../hooks";
import { useRoleAccess } from "../use-role-access";
import { RolesTable } from "./roles-table";
import { CreateRoleDialog } from "./create-role-dialog";

type TypeFilter = "all" | "system" | "custom";

function matchesType(role: Role, filter: TypeFilter): boolean {
  if (filter === "system") return role.isSystem;
  if (filter === "custom") return !role.isSystem;
  return true;
}

export function RolesPage() {
  const { canViewRoles, canCreateRoles } = useRoleAccess();
  const rolesQuery = useRoles();
  const [search, setSearch] = useState("");
  const [type, setType] = useState<TypeFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const counts = useRoleMemberCounts(roles.map((r) => r.id));

  const visible = roles.filter((r) => {
    if (!matchesType(r, type)) return false;
    if (!search) return true;
    const hay = `${r.name} ${r.description ?? ""}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  if (!canViewRoles) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view roles.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Roles</h1>
          <p className="text-sm text-muted-foreground">
            Define what each role can see and do. Higher priority manages lower.
          </p>
        </div>
        {canCreateRoles ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5 px-3.5"
            onClick={() => setCreateOpen(true)}
          >
            <ShieldPlus className="size-4" />
            New role
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search roles"
            className="h-9 pl-8"
          />
        </div>
        <Select value={type} onValueChange={(v) => setType(v as TypeFilter)}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="system">System</SelectItem>
            <SelectItem value="custom">Custom</SelectItem>
          </SelectContent>
        </Select>
        <span className="ml-auto text-sm text-muted-foreground">
          {visible.length} {visible.length === 1 ? "role" : "roles"}
        </span>
      </div>

      <div className="flex-1 px-6 pb-6">
        {rolesQuery.isLoading ? (
          <TableSkeleton />
        ) : rolesQuery.isError ? (
          <ErrorState onRetry={() => rolesQuery.refetch()} />
        ) : visible.length === 0 ? (
          <EmptyState filtered={roles.length > 0} />
        ) : (
          <RolesTable roles={visible} memberCounts={counts} />
        )}
      </div>

      <CreateRoleDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        roles={roles}
      />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border p-4">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Skeleton className="size-2.5 rounded-[3px]" />
          <Skeleton className="h-4 w-40" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <ShieldCheck className="size-6" />
      </div>
      <div>
        <div className="font-medium">
          {filtered ? "No roles match" : "No roles yet"}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {filtered
            ? "Try clearing your search or filter."
            : "Create your first custom role to get started."}
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
      <div className="font-medium">Couldn&apos;t load roles</div>
      <Button variant="outline" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}
