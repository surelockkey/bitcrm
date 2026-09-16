"use client";

import { useRef } from "react";
import { Briefcase, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { NoAccess } from "@/features/clients/components/contacts-page";
import { useMyJobs } from "../hooks";
import { PULL_THRESHOLD_PX, usePullToRefresh } from "../use-pull-to-refresh";
import { InstallHint } from "./install-hint";
import { TechJobCard } from "./tech-job-card";
import { TeamChatBadge } from "./team-chat-badge";

/**
 * `/my-jobs` — the technician's day, the way the Workiz app lists it: today
 * and what comes next, grouped by day, big cards with the time, the client,
 * where to go and how to call them. Phone-first (a pull refreshes the list,
 * the cards are thumb-sized) but it is a plain page on a laptop too.
 */
export function MyJobsPage() {
  const { can } = usePermissions();
  const jobs = useMyJobs();
  const scrollRef = useRef<HTMLDivElement>(null);
  const { pull, refreshing } = usePullToRefresh(scrollRef, () => jobs.refetch());

  if (!can("deals", "view")) return <NoAccess entity="jobs" />;

  const total = jobs.groups.reduce((n, g) => n + g.deals.length, 0);
  const busy = refreshing || jobs.isRefetching;
  // `me` has to resolve before the list can be asked for at all, so the two
  // waits read as one to the person holding the phone.
  const loading = !jobs.ready || jobs.isLoading;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold tracking-tight">My Jobs</h1>
          <p className="text-sm text-muted-foreground">
            {loading ? "Loading your day…" : `${total} job${total === 1 ? "" : "s"} on your list`}
          </p>
        </div>
        <TeamChatBadge />
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          aria-label="Refresh"
          disabled={busy}
          onClick={() => void jobs.refetch()}
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
        </Button>
      </div>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" data-testid="my-jobs-scroll">
        {/* Pull indicator: grows with the finger, spins once released past the line. */}
        <div
          aria-hidden={!busy && pull === 0}
          role="status"
          className="flex items-center justify-center overflow-hidden text-muted-foreground transition-[height] duration-100"
          style={{ height: busy ? 40 : pull }}
        >
          {busy ? (
            <span className="inline-flex items-center gap-2 text-xs">
              <Loader2 className="size-4 animate-spin" /> Refreshing…
            </span>
          ) : pull > 0 ? (
            <span className="text-xs">{pull >= PULL_THRESHOLD_PX ? "Release to refresh" : "Pull to refresh"}</span>
          ) : null}
        </div>

        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 pb-24 pt-2 sm:px-6">
          {/* Only where installing is possible, and only until it's done. */}
          <InstallHint />
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-36 w-full rounded-xl" />
              <Skeleton className="h-36 w-full rounded-xl" />
            </div>
          ) : jobs.isError ? (
            <div className="rounded-xl border border-dashed p-8 text-center">
              <p className="text-sm font-medium">Couldn&apos;t load your jobs</p>
              <p className="mt-1 text-sm text-muted-foreground">Check your connection and pull to try again.</p>
            </div>
          ) : (
            jobs.groups.map((group) => (
              <section key={group.key} aria-labelledby={`jobs-${group.key}`} data-testid={`job-group-${group.key}`}>
                <div className="mb-2 flex items-baseline gap-2">
                  <h2
                    id={`jobs-${group.key}`}
                    className={cn(
                      "text-sm font-semibold uppercase tracking-wide",
                      group.key === "overdue" ? "text-red-600 dark:text-red-400" : "text-muted-foreground",
                    )}
                  >
                    {group.label}
                  </h2>
                  <span className="text-xs text-muted-foreground tabular-nums">{group.deals.length}</span>
                </div>
                {group.deals.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed py-10 text-center">
                    <Briefcase className="size-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground">Nothing scheduled for today yet.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {group.deals.map((deal, i) => (
                      <TechJobCard
                        key={deal.id}
                        deal={deal}
                        position={group.dateIso ? i + 1 : undefined}
                      />
                    ))}
                  </div>
                )}
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
