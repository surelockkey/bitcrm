"use client";

import { useMemo, useState } from "react";
import { MapsProvider } from "@/components/maps/maps-provider";
import { Briefcase, KeyRound, Layers, Loader2, TriangleAlert, Wrench } from "lucide-react";
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
import { useAllTechnicians, useTechnicianLocations } from "@/features/technicians/hooks";
import { filterDeals, stageLabel, STAGE_ORDER, jobTypeLabel } from "@/features/deals/lib";
import { contactName } from "@/features/clients/lib";
import { EditDealSheet } from "@/features/deals/components/edit-deal-sheet";
import { DispatchMap } from "./dispatch-map";
import { JobList } from "./job-list";
import { TechList } from "./tech-list";
import { JobSidebar } from "./job-sidebar";
import { splitByLocation, technicianPositions, mergeLivePositions, todayISO } from "../lib";

const ALL = "all";
const JOB_TYPES = ["lockout", "rekey", "lock_change", "installation", "repair", "safe", "automotive", "commercial", "other"];

const LAYER_OPTIONS = [
  { value: "both", label: "Both", title: "Show jobs and technicians", icon: Layers },
  { value: "jobs", label: "Jobs", title: "Show jobs only", icon: Briefcase },
  { value: "techs", label: "Techs", title: "Show technicians only", icon: Wrench },
] as const;

type View = "split" | "map" | "list";
/** Which marker layers the map draws. */
type Layer = "both" | "jobs" | "techs";

export function DispatchPage() {
  const { can } = usePermissions();

  const [view, setView] = useState<View>("split");
  const [layer, setLayer] = useState<Layer>("both");
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
  const { data: liveLocations } = useTechnicianLocations(canSeeTechs);

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

  const technicians = useMemo(() => {
    const derived = technicianPositions(profiles, deals, todayISO());
    // A real GPS fix beats the inferred home/last-job position when the
    // technician is online.
    return mergeLivePositions(derived, liveLocations ?? [], Date.now());
  }, [profiles, deals, liveLocations]);

  // The layer toggle only hides markers; the job list stays as the work queue.
  const showJobLayer = layer !== "techs";
  const showTechLayer = layer !== "jobs" && canSeeTechs;
  const mapJobs = showJobLayer ? mapped : [];
  const mapTechs = showTechLayer ? technicians : [];

  const selected = useMemo(
    () => filtered.find((d) => d.id === selectedId) ?? null,
    [filtered, selectedId],
  );

  // Where to centre the map when something is selected — a job pin or a
  // technician marker. Deal ids and technician userIds don't collide.
  const selectedPosition = useMemo(() => {
    if (!selectedId) return null;
    const deal = mapped.find((d) => d.id === selectedId);
    if (deal) return { lat: deal.address.lat, lng: deal.address.lng };
    const tech = technicians.find((t) => t.userId === selectedId);
    if (tech) return { lat: tech.lat, lng: tech.lng };
    return null;
  }, [selectedId, mapped, technicians]);

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

        {/* Layer toggle — what the map draws. Hidden in list view (no map) and
            without technician access the "techs"/"both" split is meaningless. */}
        {showMap && canSeeTechs ? (
          <div className="flex rounded-md border p-0.5">
            {LAYER_OPTIONS.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant={layer === opt.value ? "secondary" : "ghost"}
                className="h-7 gap-1.5 px-3 text-xs"
                onClick={() => setLayer(opt.value)}
                title={opt.title}
              >
                <opt.icon className="size-3.5" />
                {opt.label}
              </Button>
            ))}
          </div>
        ) : null}

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
              {/* The list follows the layer: the technician roster in "Techs",
                  the job queue otherwise. */}
              {layer === "techs" ? (
                <TechList
                  userIds={profiles.map((p) => p.userId)}
                  positions={technicians}
                  userMap={users}
                  hoveredId={hoveredId}
                  selectedId={selectedId}
                  onHover={setHoveredId}
                  onSelect={setSelectedId}
                />
              ) : (
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
              )}
            </aside>
          ) : null}

          {showMap ? (
            <div className="relative flex-1">
              {/* Both are required: without a vector Map ID the map loads but
                  draws no pins, which looks like a bug rather than a gap in setup. */}
              {env.googleMapsApiKey && env.googleMapsMapId ? (
                <MapsProvider>
                  <DispatchMap
                    deals={mapJobs}
                    technicians={mapTechs}
                    userMap={users}
                    hoveredId={hoveredId}
                    selectedId={selectedId}
                    panTo={selectedPosition}
                    onHover={setHoveredId}
                    onSelect={setSelectedId}
                    label={(d) =>
                      `#${d.dealNumber} · ${contactNames.get(d.contactId) ?? "Unknown client"}`
                    }
                  />
                </MapsProvider>
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
