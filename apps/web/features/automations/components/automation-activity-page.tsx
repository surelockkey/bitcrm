"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, History, Loader2 } from "lucide-react";
import { AUTOMATION_RUN_OUTCOMES, type AutomationRule, type AutomationRun } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { getApiErrorMessage } from "@/lib/api/errors";
import { useAutomations, useAutomationsAccess, useAutomationRunsFeed , useAutomationRunsFeedCount } from "../hooks";
import { OUTCOME_LABEL, formatFiredAt } from "../lib";
import { RunActions, RunLine, RunOutcomeBadge } from "./automation-activity-run";
import { ListPagination } from "@/components/ui/list-pagination";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";

const ALL = "all";
const PAGE = 50;

/** The date filter the feed can serve: `since`, never a closed range. */
export const SINCE_OPTIONS = [
  { value: ALL, label: "Anytime (30 days)" },
  { value: "today", label: "Today" },
  { value: "24h", label: "Last 24 hours" },
  { value: "7d", label: "Last 7 days" },
  { value: "14d", label: "Last 14 days" },
] as const;

/** `"7d"` → the ISO instant seven days back; `"all"` → no bound at all. */
export function sinceInstant(key: string, now: Date = new Date()): string | undefined {
  if (key === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.toISOString();
  }
  const days = key === "24h" ? 1 : key === "7d" ? 7 : key === "14d" ? 14 : 0;
  return days ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString() : undefined;
}

const shortId = (id: string) => (id.length > 10 ? id.slice(0, 8) : id);

/**
 * `/automations/activity` (§4.6, plan item 23) — every firing of every rule
 * for the last 30 days, newest first: our answer to the "AUTOMATED
 * NOTIFICATION" label in the Workiz Message Center, with structured
 * outcomes, the message as it went out, and filters by rule, outcome and date.
 */
export function AutomationActivityPage() {
  const params = useSearchParams();
  const { canView, isLoading: loadingAccess } = useAutomationsAccess();

  // The rule's own log links here (`?rule=`); after that the selects own it.
  const [ruleId, setRuleId] = useState<string>(() => params.get("rule") ?? ALL);
  const [outcome, setOutcome] = useState<string>(ALL);
  const [sinceKey, setSinceKey] = useState<string>(ALL);

  // Frozen per choice: `new Date()` read on every render would rewrite the
  // query key each time and the feed would refetch forever.
  const since = useMemo(() => sinceInstant(sinceKey), [sinceKey]);

  const { data: rules, isError: rulesFailed } = useAutomations(canView);
  const [pageSize, setPageSize] = usePageSize("automation-activity");
  const feed = useAutomationRunsFeed(
    {
      limit: pageSize,
      ...(ruleId === ALL ? {} : { ruleId }),
      ...(outcome === ALL ? {} : { outcome }),
      ...(since ? { since } : {}),
    },
    canView,
  );

  const count = useAutomationRunsFeedCount(
    {
      ...(ruleId === ALL ? {} : { ruleId }),
      ...(outcome === ALL ? {} : { outcome }),
      ...(since ? { since } : {}),
    },
    canView,
  );
  const pager = usePager(pagedSource(feed, (page: { items: AutomationRun[] }) => page.items), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: JSON.stringify({ ruleId, outcome, sinceKey, pageSize }),
  });
  const runs = useMemo(() => {
    // Refetching re-reads the page: a firing logged in between can shift a row
    // and arrive twice (duplicate React keys, and a reader counting it twice).
    const seen = new Set<string>();
    return pager.items.filter((run) => {
      if (seen.has(run.id)) return false;
      seen.add(run.id);
      return true;
    });
  }, [pager.items]);
  const byId = useMemo(
    () => new Map((rules ?? []).map((rule: AutomationRule) => [rule.id, rule])),
    [rules],
  );
  // A name is only missing for certain once the rules themselves have loaded:
  // while that request is in flight (or after it failed) an unknown id means
  // "not known yet", not "deleted".
  const namesKnown = !!rules && !rulesFailed;

  /**
   * A deleted rule's firings stay in the feed for 30 days — the rule did
   * fire — so its id is still worth filtering by even though `GET
   * /automations` no longer lists it. The options are the union of the
   * rules, the ids the feed brought back, and whatever is selected.
   */
  const ruleOptions = useMemo(() => {
    const unnamed = (id: string) =>
      namesKnown ? `Deleted rule ${shortId(id)}` : `Rule ${shortId(id)}`;
    const options = new Map<string, string>();
    for (const rule of rules ?? []) options.set(rule.id, rule.name);
    for (const run of runs) if (!options.has(run.ruleId)) options.set(run.ruleId, unnamed(run.ruleId));
    if (ruleId !== ALL && !options.has(ruleId)) options.set(ruleId, unnamed(ruleId));
    return [...options.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rules, runs, ruleId, namesKnown]);

  const narrowed = ruleId !== ALL || outcome !== ALL || sinceKey !== ALL;
  const clearFilters = () => {
    setRuleId(ALL);
    setOutcome(ALL);
    setSinceKey(ALL);
  };

  if (!loadingAccess && !canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view automations.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/automations"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
          >
            <ArrowLeft className="size-3.5" />
            Automations
          </Link>
          <h1 className="mt-1 text-lg font-semibold tracking-tight">Activity</h1>
          <p className="text-sm text-muted-foreground">
            Every firing of every rule, newest first. The log is kept for 30 days.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={ruleId} onValueChange={setRuleId}>
          <SelectTrigger className="h-9 w-64" aria-label="Rule">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All rules</SelectItem>
            {ruleOptions.map(([id, name]) => (
              <SelectItem key={id} value={id}>
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={outcome} onValueChange={setOutcome}>
          <SelectTrigger className="h-9 w-44" aria-label="Outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Any outcome</SelectItem>
            {/* `dry_run` is a test run, and a test run is never logged — an
                option for it could only ever come back empty. */}
            {AUTOMATION_RUN_OUTCOMES.filter((value) => value !== "dry_run").map((value) => (
              <SelectItem key={value} value={value}>
                {OUTCOME_LABEL[value]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={sinceKey} onValueChange={setSinceKey}>
          <SelectTrigger className="h-9 w-48" aria-label="Date">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SINCE_OPTIONS.map(({ value, label }) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {narrowed ? (
          <Button variant="link" size="sm" className="h-auto p-0" onClick={clearFilters}>
            Clear filters
          </Button>
        ) : null}
      </div>

      {/* The feed is held back until the permission is known, so waiting on
          it must read as the wait it is and not as an empty workspace. */}
      {loadingAccess || feed.isPending ? (
        <div className="space-y-2">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : feed.isError ? (
        // A request that failed is not a workspace whose rules never fired.
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <p className="text-sm font-medium">The activity could not be loaded</p>
          <p className="text-sm text-muted-foreground">{getApiErrorMessage(feed.error)}</p>
          <Button variant="outline" size="sm" className="mt-2" onClick={() => feed.refetch()}>
            Try again
          </Button>
        </div>
      ) : runs.length === 0 ? (
        <EmptyFeed
          narrowed={narrowed}
          feed={feed}
          onMore={() => void pager.next()}
          onClear={clearFilters}
        />
      ) : (
        <>
          <ul className="space-y-2" data-testid="automation-activity">
            {runs.map((run) => (
              <ActivityRow key={run.id} run={run} name={byId.get(run.ruleId)?.name} namesKnown={namesKnown} />
            ))}
          </ul>
          <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
        </>
      )}
    </div>
  );
}

/** Nothing to show — and which kind of nothing it is. */
function EmptyFeed({
  narrowed,
  feed,
  onMore,
  onClear,
}: {
  narrowed: boolean;
  feed: ReturnType<typeof useAutomationRunsFeed>;
  /** Читати далі — і стати на ту сторінку, а не лише покласти її в кеш. */
  onMore: () => void;
  onClear: () => void;
}) {
  // An outcome filter is applied after the page is read, so a page can come
  // back empty with a cursor: that means "not in the stretch read so far",
  // not "nothing happened". Offer to read on instead of claiming an answer.
  if (feed.hasNextPage) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
        <p className="text-sm font-medium">Nothing yet in the stretch read so far</p>
        <p className="text-sm text-muted-foreground">
          The log is read newest-first, a stretch at a time. Keep looking to read further back.
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2"
          disabled={feed.isFetchingNextPage}
          onClick={onMore}
        >
          {feed.isFetchingNextPage ? <Loader2 className="size-4 animate-spin" /> : "Keep looking"}
        </Button>
      </div>
    );
  }

  if (narrowed) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
        <p className="text-sm font-medium">No firing matches these filters</p>
        <Button variant="outline" size="sm" onClick={onClear}>
          Clear filters
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
      <History className="size-6 text-muted-foreground" />
      <p className="text-sm font-medium">No automation has fired yet</p>
      <p className="max-w-md text-sm text-muted-foreground">
        A rule appears here the moment its trigger happens. This feed is written as firings are
        logged — a single rule&apos;s own log, from its card on the Automations page, reaches
        further back.
      </p>
    </div>
  );
}

/** One firing: when, which rule, which entity, what happened, what was sent. */
function ActivityRow({
  run,
  name,
  namesKnown,
}: {
  run: AutomationRun;
  name?: string;
  /** Whether the rule list has loaded — an unknown id only means "deleted" then. */
  namesKnown: boolean;
}) {
  return (
    <li className="rounded-lg border p-3 text-sm" data-testid={`activity-${run.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        {name ? (
          <span className="font-medium">{name}</span>
        ) : namesKnown ? (
          // The rule is gone; the firing is not. Say so rather than showing a
          // blank name or an id nobody can look up.
          <span className="flex items-center gap-2">
            <span className="font-medium text-muted-foreground italic">
              A rule that has since been deleted
            </span>
            <Badge variant="outline" className="text-muted-foreground">
              {shortId(run.ruleId)}
            </Badge>
          </span>
        ) : (
          <span className="font-medium text-muted-foreground">Rule {shortId(run.ruleId)}</span>
        )}
        <span className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatFiredAt(run.firedAt)}
          </span>
          <RunOutcomeBadge outcome={run.outcome} />
        </span>
      </div>
      <RunLine run={run} />
      <RunActions run={run} />
    </li>
  );
}
