"use client";

import { useMemo, useState } from "react";
import { Loader2, Phone, Search } from "lucide-react";
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
import { DateTimeRangePicker } from "@/components/ui/date-time-range-picker";
import type { DateTimeRange } from "@/lib/date-range";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCallTags } from "@/features/call-tags/hooks";
import { activeCallTags } from "@/features/call-tags/lib";
import { useCallsList } from "../hooks";
import { useCallStream } from "../use-call-stream";
import { STATUS_LABEL, type CallsFilter, type CallStatus } from "../lib";
import { CallsTable } from "./calls-table";
import { LiveCalls } from "./live-calls";

const STATUS_OPTIONS = Object.keys(STATUS_LABEL) as CallStatus[];

export function CallsPage() {
  const { can } = usePermissions();

  const [number, setNumber] = useState("");
  const [direction, setDirection] = useState("all");
  const [status, setStatus] = useState("all");
  const [tagId, setTagId] = useState("all");
  // Absolute instants (UTC ISO) — the picker edits them in local time.
  const [range, setRange] = useState<DateTimeRange>({});
  const debouncedNumber = useDebouncedValue(number, 300);

  const filter: CallsFilter = useMemo(
    () => ({
      number: debouncedNumber.replace(/[^\d+]/g, "") || undefined,
      direction: direction === "all" ? undefined : direction,
      status: status === "all" ? undefined : status,
      tagId: tagId === "all" ? undefined : tagId,
      dateFrom: range.from,
      dateTo: range.to,
    }),
    [debouncedNumber, direction, status, tagId, range],
  );

  const query = useCallsList(filter);
  const calls = useMemo(() => {
    // Dedupe across pages: an SSE-driven refetch of page 1 can shift rows that
    // an older cached page still contains (duplicate React keys otherwise).
    const seen = new Set<string>();
    return (query.data?.pages.flatMap((p) => p.data) ?? []).filter((call) => {
      if (seen.has(call.callSid)) return false;
      seen.add(call.callSid);
      return true;
    });
  }, [query.data]);

  const canView = can("calls");
  // The catalog sits behind `settings.view`; without it there is nothing to
  // offer in the filter, so don't fire a request that is certain to 403.
  const { data: callTags } = useCallTags(can("settings"));
  const tagOptions = activeCallTags(callTags);
  // Real-time updates while the page is open.
  useCallStream(canView);

  if (!canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view calls.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Calls</h1>
          <p className="text-sm text-muted-foreground">
            Every call across the workspace — live first, then history.
          </p>
        </div>
      </div>

      <LiveCalls />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="Search by number…"
            className="h-9 w-56 pl-8"
            inputMode="tel"
          />
        </div>
        <Select value={direction} onValueChange={setDirection}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="Direction" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All directions</SelectItem>
            <SelectItem value="inbound">Inbound</SelectItem>
            <SelectItem value="outbound">Outbound</SelectItem>
          </SelectContent>
        </Select>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tagOptions.length ? (
          <Select value={tagId} onValueChange={setTagId}>
            <SelectTrigger className="h-9 w-40" aria-label="Call tag">
              <SelectValue placeholder="Tag" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tags</SelectItem>
              {tagOptions.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <DateTimeRangePicker
          value={range}
          onChange={setRange}
          label="Date and time range"
        />
      </div>

      {/* A tag is matched while walking the log newest-first, not looked up in
          an index — over 1.8M calls an uncommon tag can read a long way back
          for one page. Saying so is cheaper than a slow page nobody expected. */}
      {tagId !== "all" && !range.from && !range.to ? (
        <p className="-mt-2 text-xs text-muted-foreground">
          Tag search reads the log newest-first — add a date range to keep it
          quick.
        </p>
      ) : null}

      {/* History */}
      {query.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : calls.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Phone className="size-6 text-muted-foreground" />
          {/* A filtered page is filled by walking the log newest-first, and
              the server stops after a bounded stretch rather than reading the
              whole partition in one request. An empty page with a cursor
              therefore means "not in the part read so far" — saying "no calls
              found" there would be a lie, so offer to read on instead. */}
          {query.hasNextPage ? (
            <>
              <p className="text-sm font-medium">
                No calls yet in the stretch searched
              </p>
              <p className="text-sm text-muted-foreground">
                The log is searched newest-first, a stretch at a time. Keep
                searching to read further back, or narrow it with a date range.
              </p>
              <Button
                variant="outline"
                className="mt-2"
                disabled={query.isFetchingNextPage}
                onClick={() => query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Keep searching"
                )}
              </Button>
            </>
          ) : (
            <>
              <p className="text-sm font-medium">No calls found</p>
              <p className="text-sm text-muted-foreground">
                Calls appear here as your team makes and receives them.
              </p>
            </>
          )}
        </div>
      ) : (
        <>
          <CallsTable calls={calls} />
          {query.hasNextPage ? (
            <Button
              variant="outline"
              className="mx-auto"
              disabled={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Load more"
              )}
            </Button>
          ) : null}
        </>
      )}
    </div>
  );
}
