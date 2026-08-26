"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Loader2, Plus, Search, Truck } from "lucide-react";
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
import { DataScope } from "@bitcrm/types";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContainersList } from "../hooks";
import { containerTitle } from "../lib";
import { ContainersTable } from "./containers-table";
import { ContainerCreateDialog } from "./container-create-dialog";
import { MyContainerView } from "./my-container-view";

export function ContainersPage() {
  const { can, scopeOf } = usePermissions();

  if (!can("containers", "view")) {
    // Technicians hit "My Container"; anyone else without view is blocked.
    return <MyContainerView />;
  }
  // Assigned-only scope = a technician → their own van, not the fleet.
  if (scopeOf("containers") === DataScope.ASSIGNED_ONLY) {
    return <MyContainerView />;
  }
  return <Fleet />;
}

function Fleet() {
  const { can } = usePermissions();
  const query = useContainersList();
  const [search, setSearch] = useState("");
  const [department, setDepartment] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);

  const containers = useMemo(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );
  const departments = useMemo(
    () =>
      [
        ...new Set(
          containers.map((c) => c.department).filter((d): d is string => !!d),
        ),
      ].sort(),
    [containers],
  );

  const visible = containers.filter((c) => {
    if (department !== "all" && c.department !== department) return false;
    if (!search) return true;
    return containerTitle(c).toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search technician"
            className="h-9 pl-8"
          />
        </div>
        {departments.length > 1 ? (
          <Select value={department} onValueChange={setDepartment}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All departments</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d} value={d}>
                  {d}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <span className="ml-auto text-sm text-muted-foreground">
          {visible.length} {visible.length === 1 ? "container" : "containers"}
        </span>
        <Button asChild variant="outline" className="h-9 gap-1.5">
          <Link href="/technicians">
            Technicians
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
        {can("containers", "create") ? (
          <Button
            variant="brand"
            className="h-9 gap-1.5 px-3.5"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="size-4" />
            New container
          </Button>
        ) : null}
      </div>

      <div className="flex-1 px-6 pb-6">
        {query.isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Truck className="size-6" />
            </div>
            <div>
              <div className="font-medium">{containers.length ? "No containers match" : "No containers"}</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {containers.length
                  ? "Try clearing your search or filter."
                  : "A van appears here when a technician is activated."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <ContainersTable containers={visible} />
            {query.hasNextPage ? (
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => query.fetchNextPage()}
                  disabled={query.isFetchingNextPage}
                  className="gap-1.5"
                >
                  {query.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : null}
                  Load more
                </Button>
              </div>
            ) : null}
          </>
        )}
      </div>

      <ContainerCreateDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
