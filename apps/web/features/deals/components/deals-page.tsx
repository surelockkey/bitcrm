"use client";

import { useMemo, useState } from "react";
import { Briefcase, KanbanSquare, List, Plus, Search, TriangleAlert } from "lucide-react";
import { DealPriority } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { usePermissions } from "@/features/auth/use-permissions";
import { EmptyState, NoAccess } from "@/features/clients/components/contacts-page";
import Link from "next/link";
import { useContactMap, useDeals, useUserMap } from "../hooks";
import { STAGE_ORDER, filterDeals, jobTypeLabel, stageLabel, type DealFilter } from "../lib";
import { DealsBoard } from "./deals-board";
import { DealsTable } from "./deals-table";

const ALL = "all";
const JOB_TYPES = ["lockout", "rekey", "lock_change", "installation", "repair", "safe", "automotive", "commercial", "other"];

export function DealsPage() {
  const { can, isTechnician } = usePermissions();
  const dealsQuery = useDeals();
  const { map: contactMap } = useContactMap();
  const { map: userMap } = useUserMap();

  const [view, setView] = useState<"board" | "table">(isTechnician ? "table" : "board");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState(ALL);
  const [priority, setPriority] = useState(ALL);
  const [jobType, setJobType] = useState(ALL);

  const contactNames = useMemo(() => {
    const m = new Map<string, string>();
    contactMap.forEach((c, id) => m.set(id, `${c.firstName} ${c.lastName}`));
    return m;
  }, [contactMap]);

  const filtered = useMemo(() => {
    const filter: DealFilter = {
      search: search || undefined,
      stage: stage === ALL ? undefined : (stage as DealFilter["stage"]),
      priority: priority === ALL ? undefined : (priority as DealPriority),
      jobType: jobType === ALL ? undefined : jobType,
    };
    return filterDeals(dealsQuery.data ?? [], filter, contactNames);
  }, [dealsQuery.data, search, stage, priority, jobType, contactNames]);

  if (!can("deals", "view")) return <NoAccess entity="deals" />;

  const showBoard = view === "board" && !isTechnician;

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{isTechnician ? "My Jobs" : "Deals"}</h1>
          <p className="text-sm text-muted-foreground">
            {isTechnician ? "Your assigned jobs." : "The job pipeline — open a deal to move it forward."}
          </p>
        </div>
        {can("deals", "create") ? (
          <Button asChild variant="brand" className="gap-1.5">
            <Link href="/deals/new"><Plus className="size-4" /> New deal</Link>
          </Button>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 pl-8" placeholder="Search #, client, area" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <FilterSelect value={stage} onChange={setStage} allLabel="All stages" options={STAGE_ORDER.map((s) => ({ value: s, label: stageLabel(s) }))} width={160} />
        <FilterSelect value={priority} onChange={setPriority} allLabel="Any priority" options={[{ value: DealPriority.URGENT, label: "Urgent" }, { value: DealPriority.NORMAL, label: "Normal" }]} width={140} />
        <FilterSelect value={jobType} onChange={setJobType} allLabel="All jobs" options={JOB_TYPES.map((t) => ({ value: t, label: jobTypeLabel(t) }))} width={140} />
        <span className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">{filtered.length} {filtered.length === 1 ? "deal" : "deals"}</span>
          {!isTechnician ? (
            <span className="inline-flex overflow-hidden rounded-lg border">
              <button type="button" onClick={() => setView("board")} className={cn("px-2.5 py-1.5", view === "board" ? "bg-foreground text-background" : "text-muted-foreground")} aria-label="Board view"><KanbanSquare className="size-4" /></button>
              <button type="button" onClick={() => setView("table")} className={cn("px-2.5 py-1.5", view === "table" ? "bg-foreground text-background" : "text-muted-foreground")} aria-label="Table view"><List className="size-4" /></button>
            </span>
          ) : null}
        </span>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {dealsQuery.isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : dealsQuery.isError ? (
          <DealsError
            onRetry={() => dealsQuery.refetch()}
            isRetrying={dealsQuery.isFetching}
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<Briefcase className="size-6" />}
            title={dealsQuery.data?.length ? "No matching deals" : isTechnician ? "No jobs assigned yet" : "No deals yet"}
            hint={dealsQuery.data?.length ? "Try a different search or filter." : isTechnician ? "Assigned jobs will appear here." : "Create your first deal to get started."}
          />
        ) : showBoard ? (
          <DealsBoard deals={filtered} contactMap={contactMap} userMap={userMap} />
        ) : (
          <DealsTable deals={filtered} contactMap={contactMap} userMap={userMap} />
        )}
      </div>
    </div>
  );
}

function DealsError({ onRetry, isRetrying }: { onRetry: () => void; isRetrying: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <TriangleAlert className="size-6" />
      </div>
      <div className="font-medium">Couldn&apos;t load deals</div>
      <p className="max-w-xs text-sm text-muted-foreground">
        Something went wrong fetching the pipeline. Check your connection and try again.
      </p>
      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry} disabled={isRetrying}>
        {isRetrying ? "Retrying…" : "Try again"}
      </Button>
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  allLabel,
  options,
  width,
}: {
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
  width: number;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9" style={{ width }}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
