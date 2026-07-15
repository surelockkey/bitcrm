"use client";

import { useMemo, useState } from "react";
import { APIProvider } from "@vis.gl/react-google-maps";
import { KeyRound, Loader2, TriangleAlert } from "lucide-react";
import { DealStage } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { env } from "@/lib/env";
import { usePermissions } from "@/features/auth/use-permissions";
import { useContactMap, useDeals, useUserMap } from "@/features/deals/hooks";
import { useAllTechnicians } from "@/features/technicians/hooks";
import { filterDeals, stageLabel, STAGE_ORDER, jobTypeLabel } from "@/features/deals/lib";
import { contactName } from "@/features/clients/lib";
import { EditDealSheet } from "@/features/deals/components/edit-deal-sheet";
import { DispatchMap } from "./dispatch-map";
import { JobList } from "./job-list";
import { JobSidebar } from "./job-sidebar";
import { splitByLocation, technicianPositions, todayISO } from "../lib";

const ALL = "all";
const JOB_TYPES = ["lockout", "rekey", "lock_change", "installation", "repair", "safe", "automotive", "commercial", "other"];

type View = "split" | "map" | "list";

export function DispatchPage() {
  const { can } = usePermissions();

  const [view, setView] = useState<View>("split");
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState(ALL);
  const [jobType, setJobType] = useState(ALL);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const query = useDeals();
  const { map: contacts } = useContactMap();
  const { map: users } = useUserMap();
  // Technician profiles are manager+ only — firing the query regardless would
  // 403 on every load for a dispatcher who can see the map but not the roster.
  const canSeeTechs = can("technicians", "view");
  const { profiles } = useAllTechnicians(canSeeTechs);

  const deals = useMemo(() => query.data ?? [], [query.data]);

  const contactNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const [id, contact] of contacts) names.set(id, contactName(contact));
    return names;
  }, [contacts]);

  const filtered = useMemo(
    () =>
      filterDeals(
        deals,
        {
          search,
          stage: stage === ALL ? undefined : (stage as DealStage),
          jobType: jobType === ALL ? undefined : jobType,
        },
        contactNames,
      ),
    [deals, search, stage, jobType, contactNames],
  );

  const { mapped, unmapped } = useMemo(() => splitByLocation(filtered), [filtered]);

  const technicians = useMemo(
    () => technicianPositions(profiles, deals, todayISO()),
    [profiles, deals],
  );

  const selected = useMemo(
    () => filtered.find((d) => d.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  if (!can("deals", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view the dispatch map.
        </p>
      </div>
    );
  }

  const nameOf = (id?: string) => {
    if (!id) return undefined;
    const user = users.get(id);
    if (!user) return undefined;
    return `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email;
  };

  const showMap = view !== "list";
  const showList = view !== "map";

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-3">
        <div className="mr-auto">
          <h1 className="text-lg font-semibold tracking-tight">Dispatch Map</h1>
          <p className="text-sm text-muted-foreground">
            {mapped.length} on the map
            {unmapped.length > 0 ? ` · ${unmapped.length} without coordinates` : ""}
          </p>
        </div>

        <Input
          placeholder="Search client, #, area"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-9 w-52"
        />

        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All stages</SelectItem>
            {STAGE_ORDER.map((s) => (
              <SelectItem key={s} value={s}>{stageLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={jobType} onValueChange={setJobType}>
          <SelectTrigger className="h-9 w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All job types</SelectItem>
            {JOB_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{jobTypeLabel(t)}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex rounded-md border p-0.5">
          {(["split", "map", "list"] as const).map((v) => (
            <Button
              key={v}
              size="sm"
              variant={view === v ? "secondary" : "ghost"}
              className="h-7 px-3 text-xs capitalize"
              onClick={() => setView(v)}
            >
              {v}
            </Button>
          ))}
        </div>
      </div>

      {query.isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      ) : query.isError ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <TriangleAlert className="size-6 text-destructive" />
          <div className="font-medium">Couldn&apos;t load jobs</div>
          <Button variant="outline" onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : (
        <div className="flex flex-1 overflow-hidden">
          {showList ? (
            <aside
              className={view === "list" ? "flex-1 overflow-hidden" : "w-88 shrink-0 border-r"}
            >
              <JobList
                mapped={mapped}
                unmapped={unmapped}
                clientName={(d) => contactNames.get(d.contactId) ?? "Unknown client"}
                techName={(d) => nameOf(d.assignedTechId)}
                hoveredId={hoveredId}
                selectedId={selectedId}
                onHover={setHoveredId}
                onSelect={setSelectedId}
              />
            </aside>
          ) : null}

          {showMap ? (
            <div className="relative flex-1">
              {/* Both are required: without a vector Map ID the map loads but
                  draws no pins, which looks like a bug rather than a gap in setup. */}
              {env.googleMapsApiKey && env.googleMapsMapId ? (
                <APIProvider apiKey={env.googleMapsApiKey}>
                  <DispatchMap
                    deals={mapped}
                    technicians={technicians}
                    userMap={users}
                    hoveredId={hoveredId}
                    selectedId={selectedId}
                    onHover={setHoveredId}
                    onSelect={setSelectedId}
                    label={(d) =>
                      `#${d.dealNumber} · ${contactNames.get(d.contactId) ?? "Unknown client"}`
                    }
                  />
                </APIProvider>
              ) : (
                <MissingConfig
                  missingKey={!env.googleMapsApiKey}
                  missingMapId={!env.googleMapsMapId}
                />
              )}
            </div>
          ) : null}

          {selected ? (
            <JobSidebar
              deal={selected}
              clientName={contactNames.get(selected.contactId) ?? "Unknown client"}
              techName={nameOf(selected.assignedTechId)}
              canEdit={can("deals", "edit")}
              onEdit={() => setEditing(true)}
              onClose={() => setSelectedId(null)}
            />
          ) : null}
        </div>
      )}

      {selected && editing ? (
        <EditDealSheet deal={selected} open onOpenChange={setEditing} />
      ) : null}
    </div>
  );
}

/**
 * A blank grey rectangle would read as a bug. Name exactly what is missing —
 * especially the Map ID, whose absence looks identical to broken pin code.
 */
function MissingConfig({
  missingKey,
  missingMapId,
}: {
  missingKey: boolean;
  missingMapId: boolean;
}) {
  return (
    <div className="flex size-full flex-col items-center justify-center gap-3 bg-muted/30 p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <KeyRound className="size-6" />
      </div>
      <div className="font-medium">The map needs Google Maps configuration</div>
      <ul className="max-w-sm space-y-1.5 text-sm text-muted-foreground">
        {missingKey ? (
          <li>
            <code className="rounded bg-muted px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> — a
            browser key with the Maps JavaScript and Places APIs enabled.
          </li>
        ) : null}
        {missingMapId ? (
          <li>
            <code className="rounded bg-muted px-1">NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID</code> — a{" "}
            <b>vector</b> Map ID from Map management. Job pins use AdvancedMarker, which draws
            nothing without one.
          </li>
        ) : null}
      </ul>
      <p className="text-xs text-muted-foreground">
        Set them in <code className="rounded bg-muted px-1">apps/web/.env</code>. The job list
        works without either.
      </p>
    </div>
  );
}
