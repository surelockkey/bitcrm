"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ClipboardCheck, Loader2, TriangleAlert, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/features/auth/use-permissions";
import { useTechnicians, useUserMap, usePendingAssignments } from "../hooks";
import { TechniciansTable } from "./technicians-table";
import { AssignmentsQueueDialog } from "./assignments-queue-dialog";

export function TechniciansPage() {
  const { can } = usePermissions();
  const [status, setStatus] = useState("all");
  const [queueOpen, setQueueOpen] = useState(false);

  const query = useTechnicians(status === "all" ? undefined : status);
  const { data: userMap } = useUserMap();
  const canApprove = can("job_types", "approve");
  const { data: pending } = usePendingAssignments(canApprove);

  const technicians = useMemo(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data],
  );
  const pendingCount = (pending?.jobTypes.length ?? 0) + (pending?.serviceAreas.length ?? 0);

  if (!can("technicians", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view technicians.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Technicians</h1>
          <p className="text-sm text-muted-foreground">
            Field team — onboarding, skills, commission, and paperwork.
          </p>
        </div>
        <Button asChild variant="outline" className="h-9 gap-1.5">
          <Link href="/admin/users">
            Add via Users
            <ArrowUpRight className="size-3.5" />
          </Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2 px-6 py-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
          </SelectContent>
        </Select>

        {canApprove && pendingCount > 0 ? (
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-1.5 border-amber-500/40 text-amber-700 dark:text-amber-500"
            onClick={() => setQueueOpen(true)}
          >
            <ClipboardCheck className="size-4" />
            {pendingCount} assignment{pendingCount === 1 ? "" : "s"} awaiting review
          </Button>
        ) : null}

        <span className="ml-auto text-sm text-muted-foreground">
          {technicians.length}
          {query.hasNextPage ? "+" : ""} technician{technicians.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="flex-1 px-6 pb-6">
        {query.isLoading ? (
          <div className="space-y-2 rounded-lg border p-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="ml-auto h-4 w-20" />
              </div>
            ))}
          </div>
        ) : query.isError ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <TriangleAlert className="size-6" />
            </div>
            <div className="font-medium">Couldn&apos;t load technicians</div>
            <Button variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : technicians.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed py-16 text-center">
            <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
              <Wrench className="size-6" />
            </div>
            <div>
              <div className="font-medium">No technicians</div>
              <p className="mt-1 text-sm text-muted-foreground">
                A profile appears here when a user is given the Technician role.
              </p>
            </div>
          </div>
        ) : (
          <>
            <TechniciansTable technicians={technicians} userMap={userMap ?? new Map()} />
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

      <AssignmentsQueueDialog
        open={queueOpen}
        onOpenChange={setQueueOpen}
        userMap={userMap ?? new Map()}
      />
    </div>
  );
}
