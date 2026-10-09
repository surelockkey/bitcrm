"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AUTOMATION_RUN_OUTCOMES, type AutomationRule, type AutomationRun } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { ListPagination } from "@/components/ui/list-pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { getApiErrorMessage } from "@/lib/api/errors";
import { pagedSource } from "@/lib/paging/paged-source";
import { usePageSize } from "@/lib/paging/use-page-size";
import { usePager } from "@/lib/paging/use-pager";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useAutomations, useAutomationsAccess, useAutomationRunsFeed, useAutomationRunsFeedCount } from "../hooks";
import { OUTCOME_LABEL, formatFiredAt } from "../lib";
import { RunActions, RunLine, RunOutcomeBadge } from "./automation-activity-run";
import {
  CENTER_CARD_SHADOW,
  CenterCardBar,
  CenterEmptyState,
  CenterFact,
  CenterFacts,
  CenterFrame,
  CenterSideTitle,
  CenterStat,
  CenterTabs,
} from "./automation-center";
import { EmptyAutomationsArt, NoResultsArt } from "./automation-center-art";

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
 * Drawn in the Automation Center's frame as its third tab (pg_automations).
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

  const rulesQuery = useAutomations(canView);
  const { data: rules, isError: rulesFailed } = rulesQuery;
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
  const feedKey = JSON.stringify({ ruleId, outcome, sinceKey, pageSize });
  const pager = usePager(pagedSource(feed, (page: { items: AutomationRun[] }) => page.items), {
    total: count.data?.total,
    totalIsFloor: count.data?.atLeast,
    pageSize,
    resetKey: feedKey,
  });

  // One skeleton, then the firings whole. They used to land first and be
  // rewritten under the reader — "Rule 1a2b3c4d" until the rules came with
  // the names, the "of N" under them later still. The filters wait with them
  // the first time (a rule picked by link names itself from the same list);
  // the firings start over when a filter changes, like any new list.
  const allIn = !loadingAccess && [rulesQuery, feed, count].every(settled);
  const pageShown = usePageReady(allIn);
  const feedShown = usePageReady(allIn, feedKey);
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
        <h2 className="text-lg font-semibold">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view automations.</p>
      </div>
    );
  }

  const side = (
    <div>
      <CenterSideTitle>Activity</CenterSideTitle>
      <p className="mt-4 text-[13px] leading-[19px] tracking-[0.4px] text-wz-outline-label">
        Every firing of every rule, newest first. The log is kept for 30 days.
      </p>
      {count.data ? (
        <CenterStat label={narrowed ? "Firings found" : "Firings, 30 days"} value={count.data.total} />
      ) : null}
    </div>
  );

  const actions = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
      <Select value={ruleId} onValueChange={setRuleId}>
        <SelectTrigger className="h-10 w-[376px]" aria-label="Rule">
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
        <SelectTrigger className="h-10 w-[200px]" aria-label="Outcome">
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
        <SelectTrigger className="h-10 w-[200px]" aria-label="Date">
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
        <button
          type="button"
          onClick={clearFilters}
          className="cursor-pointer text-[13px] leading-[19px] font-semibold tracking-[0.4px] text-wz-link outline-none hover:underline focus-visible:ring-2 focus-visible:ring-wz-focus"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );

  return (
    // The Automation Center's frame, on its third tab. Workiz keeps no log of
    // its own (what its automations sent shows in the Message Center under an
    // AUTOMATED NOTIFICATION label); this page is ours, drawn the Center's way.
    <CenterFrame waiting={!pageShown} side={side} tabs={<CenterTabs active="activity" />} actions={actions}>
      {/* The feed is held back until the permission is known, so waiting on
          it must read as the wait it is and not as an empty workspace. */}
      {!feedShown ? (
        <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading the activity">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[159px] w-full rounded-[16px]" />
          ))}
        </div>
      ) : feed.isError ? (
        // A request that failed is not a workspace whose rules never fired.
        <CenterEmptyState
          art={<NoResultsArt />}
          title="The activity could not be loaded"
          action={
            <WzButton size="regular" variant="secondary" onClick={() => feed.refetch()}>
              Try again
            </WzButton>
          }
        >
          {getApiErrorMessage(feed.error)}
        </CenterEmptyState>
      ) : runs.length === 0 ? (
        <EmptyFeed narrowed={narrowed} feed={feed} onMore={() => void pager.next()} onClear={clearFilters} />
      ) : (
        <>
          <ul className="flex flex-col gap-6 pt-1" data-testid="automation-activity">
            {runs.map((run) => (
              <ActivityRow key={run.id} run={run} name={byId.get(run.ruleId)?.name} namesKnown={namesKnown} />
            ))}
          </ul>
          <div className="mt-6">
            <ListPagination pager={pager} size={pageSize} onSizeChange={setPageSize} />
          </div>
        </>
      )}
    </CenterFrame>
  );
}

/** Nothing to show — and which kind of nothing it is, in the Center's empty state. */
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
      <CenterEmptyState
        art={<NoResultsArt />}
        title="Nothing yet in the stretch read so far"
        action={
          <WzButton size="regular" variant="secondary" loading={feed.isFetchingNextPage} onClick={onMore}>
            Keep looking
          </WzButton>
        }
      >
        The log is read newest-first, a stretch at a time. Keep looking to read further back.
      </CenterEmptyState>
    );
  }

  if (narrowed) {
    return (
      <CenterEmptyState
        art={<NoResultsArt />}
        title="No firing matches these filters"
        action={
          <WzButton size="regular" variant="secondary" onClick={onClear}>
            Clear filters
          </WzButton>
        }
      />
    );
  }

  return (
    <CenterEmptyState art={<EmptyAutomationsArt />} title="No automation has fired yet">
      A rule appears here the moment its trigger happens. This feed is written as firings are logged — a single
      rule&apos;s own log, from its card on the Automations page, reaches further back.
    </CenterEmptyState>
  );
}

/**
 * One firing, drawn as the Center draws a rule (`ruleCard`): the rule's name
 * with how the firing ended at the right, the green bar, what it sent, and the
 * info row — when it fired and what it was about.
 */
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
    <li
      className={cn("flex flex-col rounded-[16px] bg-white px-6 pt-6 pb-5", CENTER_CARD_SHADOW)}
      data-testid={`activity-${run.id}`}
    >
      <div className="flex w-full items-center justify-between gap-4">
        {name ? (
          <h4 className="min-w-0 truncate text-sm leading-[22px] font-semibold tracking-[0.4px] text-foreground">{name}</h4>
        ) : namesKnown ? (
          // The rule is gone; the firing is not. Say so rather than showing a
          // blank name or an id nobody can look up.
          <h4 className="flex min-w-0 items-center gap-2 text-sm leading-[22px] font-semibold tracking-[0.4px] text-wz-outline-label">
            <span className="truncate italic">A rule that has since been deleted</span>
            <Badge variant="outline" className="text-wz-outline-label">
              {shortId(run.ruleId)}
            </Badge>
          </h4>
        ) : (
          <h4 className="min-w-0 truncate text-sm leading-[22px] font-semibold tracking-[0.4px] text-wz-outline-label">
            Rule {shortId(run.ruleId)}
          </h4>
        )}
        <RunOutcomeBadge outcome={run.outcome} />
      </div>
      <CenterCardBar />
      <div className="mb-3">
        <RunActions run={run} />
      </div>
      <CenterFacts>
        <CenterFact first>Fired on {formatFiredAt(run.firedAt)}</CenterFact>
        <CenterFact>
          <RunLine run={run} bare />
        </CenterFact>
      </CenterFacts>
    </li>
  );
}
