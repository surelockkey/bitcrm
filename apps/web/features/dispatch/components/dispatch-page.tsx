"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, TriangleAlert } from "lucide-react";
import type { Deal } from "@bitcrm/types";
import { MapsProvider } from "@/components/maps/maps-provider";
import { Button } from "@/components/ui/button";
import { getApiErrorMessage } from "@/lib/api/errors";
import { env } from "@/lib/env";
import { useDenied, usePermissions } from "@/features/auth/use-permissions";
import { useDeal, useReorderDeals } from "@/features/deals/hooks";
import { dealClientName, filterDeals, jobOwnNumbers } from "@/features/deals/lib";
import { personName } from "@/features/deals/person-name";
import { EditDealSheet } from "@/features/deals/components/edit-deal-sheet";
import { AssignTechDialog } from "@/features/deals/components/assign-tech-dialog";
import type { DealsWindow } from "@/features/deals/window";
import { useJobTypes } from "@/features/job-types/hooks";
import { activeJobTypes, useJobTypeName } from "@/features/job-types/lib";
import { DispatchBoardSkeleton, DispatchListSkeleton } from "./board-skeleton";
import { DispatchMap } from "./dispatch-map";
import { ServiceAreaLegend } from "./service-area-overlay";
import { JobList } from "./job-list";
import { TechList, techRows } from "./tech-list";
import { JobPinCard } from "./job-pin-card";
import { TechPinCard } from "./tech-pin-card";
import { MapDateBox } from "./map-date-box";
import { MapFiltersPanel } from "./map-filters-panel";
import { MapSidebar, MapToggleRow, type MapTab } from "./map-sidebar";
import { splitByLocation, techJobsToday, todayISO, type LocatedDeal } from "../lib";
import { useDispatchBoard, type DispatchBoard } from "../use-dispatch-board";
import { localToday, mapRangeWindow, shiftMapRange, type MapRange } from "../map-range";
import {
  EMPTY_MAP_FILTERS,
  MAP_CLOSED_STATUSES,
  closedMapWindow,
  mapFoundText,
  matchesMapFilters,
  sortByName,
  type MapFilters,
} from "../map-filters";
import { jobCardTitle } from "../map-words";

/**
 * What the board reads: every open job, whatever its date — Workiz's
 * `map/getJobs` — once. The date box and the Filters only choose among them.
 * Ours on top: Done / Canceled, read for the date box's days once ticked.
 */
const BOARD_WINDOW: DealsWindow = {};

/** What the dispatcher set, kept across reloads (story 4.01). */
interface MapPrefs {
  search: string;
  filters: MapFilters;
  range: MapRange;
  showTechs: boolean;
  showAreas: boolean;
}

const DEFAULT_PREFS: MapPrefs = {
  search: "",
  filters: EMPTY_MAP_FILTERS,
  range: "week",
  // Workiz's Jobs tab draws jobs only; the team is its own tab.
  showTechs: false,
  // Ours: dispatchers asked to see where jobs fall relative to their areas.
  showAreas: true,
};

const PREFS_KEY = "dispatch:map";

function loadPrefs(): MapPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.sessionStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT_PREFS;
    const saved = JSON.parse(raw) as Partial<MapPrefs>;
    return { ...DEFAULT_PREFS, ...saved, filters: { ...EMPTY_MAP_FILTERS, ...saved.filters } };
  } catch {
    return DEFAULT_PREFS;
  }
}

/** Before the first board is in: nothing to read yet. */
const NO_BOARD: DispatchBoard = {
  window: {},
  deals: [],
  closedDeals: [],
  closedWindow: null,
  failed: false,
  updatedAt: 0,
  contacts: new Map(),
  users: new Map(),
  profiles: [],
  technicians: [],
  fixesAt: 0,
  addresses: new Map(),
  areas: [],
};

export function DispatchPage() {
  return (
    // One Maps loader for the whole page — the map and the roster's reverse
    // geocoding share it, and it starts loading with the page rather than
    // once the jobs are in. Passes through untouched when there's no key.
    <MapsProvider>
      <DispatchBoardPage />
    </MapsProvider>
  );
}

/**
 * The dispatch map — Workiz's Map (`/root/map`, pg_dispatch_wz_*): a 386px
 * sidebar (Search + Filter by, Jobs | Techs, the cards) beside Google's map,
 * with the date box floating over it on the Jobs tab. Ours on top, in
 * Workiz's places: assigning from a pin's card, live GPS on the tech pins,
 * the service-area overlay, the day's re-sequencing on a tech's card.
 */
function DispatchBoardPage() {
  const router = useRouter();
  const { can } = usePermissions();
  const denied = useDenied();
  const jobTypeName = useJobTypeName();
  const { data: jobTypes } = useJobTypes();

  const [tab, setTab] = useState<MapTab>("jobs");
  const [prefs, setPrefs] = useState<MapPrefs>(loadPrefs);
  const [anchor, setAnchor] = useState(() => localToday());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Bumped on every selection so the map re-centres even when the same item is
  // clicked again — panning off a coordinate change alone wouldn't re-fire.
  const [panNonce, setPanNonce] = useState(0);
  const [editing, setEditing] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const { search, filters, range, showTechs, showAreas } = prefs;
  const patch = (p: Partial<MapPrefs>) => setPrefs((s) => ({ ...s, ...p }));

  useEffect(() => {
    try {
      window.sessionStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
    } catch {
      /* private mode / quota — the choices just won't persist */
    }
  }, [prefs]);

  const select = useCallback((id: string) => {
    setSelectedId(id);
    setPanNonce((n) => n + 1);
  }, []);

  // A pick on one tab means nothing on the other — a job has no card among
  // the techs and vice versa.
  const pickTab = (next: MapTab) => {
    if (next === tab) return;
    setTab(next);
    setSelectedId(null);
    setHoveredId(null);
    setFiltersOpen(false);
  };

  // Technician profiles are manager+ only — firing the query regardless would
  // 403 on every load for a dispatcher who can see the map but not the roster.
  const canSeeTechs = can("technicians", "view");
  // Only fetch the catalog when the viewer can read it.
  const canSeeAreas = can("service_areas", "view");
  const canEdit = can("deals", "edit");
  // Everything the board draws, held back until all of it is in — and from
  // then on the last complete board while a poll brings the next.
  // The chosen days. Done / Canceled (ours) are read only once ticked, for those days.
  const days = mapRangeWindow(range, anchor);
  // Kept by value: a new object every render would read as a new board every render.
  const closedKey = JSON.stringify(closedMapWindow(filters, days));
  const closedWindow = useMemo(() => JSON.parse(closedKey) as DealsWindow | null, [closedKey]);
  // The board waits only for what is drawn: the team when it is on the map
  // or in the list, its streets when the Techs tab lists them.
  const shows = useMemo(
    () => ({ techs: canSeeTechs && (tab === "techs" || showTechs), streets: canSeeTechs && tab === "techs" }),
    [canSeeTechs, tab, showTechs],
  );
  const { board, query, techsReady } = useDispatchBoard(BOARD_WINDOW, {
    techs: canSeeTechs,
    areas: canSeeAreas,
    closed: closedWindow,
    shows,
  });
  const {
    deals,
    closedDeals,
    contacts,
    users,
    profiles,
    technicians,
    fixesAt,
    addresses,
    areas: serviceAreasData,
  } = board ?? NO_BOARD;
  const reorder = useReorderDeals();

  const nameOf = useCallback((id: string) => personName(users.get(id)) ?? "Technician", [users]);
  const clientOf = useCallback((d: Deal) => dealClientName(d, contacts.get(d.contactId)), [contacts]);
  const titleOf = useCallback((d: Deal) => jobCardTitle(jobTypeName(d.jobTypeId), d.dealNumber), [jobTypeName]);

  // The search and the Filters over the chosen days — all on the jobs in hand.
  const held = useMemo(() => (closedDeals.length ? [...deals, ...closedDeals] : deals), [deals, closedDeals]);
  const filtered = useMemo(
    () =>
      filterDeals(held, { search, dateFrom: days.from, dateTo: days.to }, contacts).filter((d) =>
        matchesMapFilters(d, filters),
      ),
    [held, search, days.from, days.to, contacts, filters],
  );
  const { mapped, unmapped } = useMemo(() => splitByLocation(filtered), [filtered]);

  const people = useMemo(
    () =>
      techRows({
        userIds: profiles.map((p) => p.userId),
        positions: technicians,
        userMap: users,
        now: fixesAt,
        query: tab === "techs" ? search : "",
      }),
    [profiles, technicians, users, fixesAt, tab, search],
  );

  // The map's layers: the Jobs tab draws jobs (and the team when asked), the
  // Techs tab the team alone.
  const mapJobs = tab === "jobs" ? mapped : [];
  const drawTechs = canSeeTechs && (tab === "techs" || showTechs);
  const shownTechIds = useMemo(() => new Set(people.map((p) => p.userId)), [people]);
  const mapTechs = useMemo(
    () => (drawTechs ? technicians.filter((t) => tab === "jobs" || shownTechIds.has(t.userId)) : []),
    [drawTechs, technicians, tab, shownTechIds],
  );
  // Memoized so the overlay's polygons only rebuild when the set changes.
  const mapAreas = useMemo(
    () => (showAreas && canSeeAreas ? serviceAreasData : []),
    [showAreas, canSeeAreas, serviceAreasData],
  );

  const selectedDeal = useMemo(() => filtered.find((d) => d.id === selectedId) ?? null, [filtered, selectedId]);

  // Where to centre the map when something is picked — a job pin or a
  // technician. Deal ids and technician userIds don't collide.
  const selectedPosition = useMemo(() => {
    if (!selectedId) return null;
    const deal = mapped.find((d) => d.id === selectedId);
    if (deal) return { lat: deal.address.lat, lng: deal.address.lng };
    const tech = technicians.find((t) => t.userId === selectedId);
    if (tech) return { lat: tech.lat, lng: tech.lng };
    return null;
  }, [selectedId, mapped, technicians]);

  // The Filters' lists: everyone A→Z, every area, the live job types.
  const techOptions = useMemo(
    () =>
      sortByName(
        [...users.values()].flatMap((u) => {
          const label = personName(u);
          return label ? [{ value: u.id, label }] : [];
        }),
      ),
    [users],
  );
  const areaOptions = useMemo(() => {
    const names = new Set<string>(deals.map((d) => d.serviceArea).filter(Boolean));
    for (const a of serviceAreasData) if (a.active) names.add(a.name);
    return sortByName([...names].map((n) => ({ value: n, label: n })));
  }, [deals, serviceAreasData]);
  const jobTypeOptions = useMemo(
    () => activeJobTypes(jobTypes).map((t) => ({ value: t.id, label: t.name })),
    [jobTypes],
  );

  // Refused only once the permissions say so — not on every refresh while
  // they are still on their way.
  if (denied("deals", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view the dispatch map.
        </p>
      </div>
    );
  }

  // One wait for the whole board, then the board in one frame — behind the
  // page's own shape meanwhile, not a spinner: every open job is one request
  // (`GET /deals/map`), but against a deal-service without it they drain a
  // hundred a page and take seconds.
  if (!board) return <DispatchBoardSkeleton showTabs={canSeeTechs} />;

  // Enter in the search box centres the map on the first match.
  const zoomToFirstMatch = () => {
    if (tab === "jobs" && mapped.length > 0) select(mapped[0].id);
    if (tab === "techs") {
      const first = people.find((p) => p.locatable);
      if (first) select(first.userId);
    }
  };

  const jobCard = (deal: LocatedDeal) => (
    <JobPinCard
      deal={deal}
      title={titleOf(deal)}
      clientName={clientOf(deal)}
      phone={jobOwnNumbers(deal)[0] ?? contacts.get(deal.contactId)?.phones?.[0]}
      techNames={deal.assignedTechIds.length ? deal.assignedTechIds.map(nameOf).join(", ") : undefined}
      sequence={deal.assignedTechIds[0] ? deal.sequences?.[deal.assignedTechIds[0]] : undefined}
      canEdit={canEdit}
      onEdit={() => setEditing(true)}
      onView={() => router.push(`/deals/${deal.id}`)}
      onAssign={() => setAssigning(true)}
      onClose={() => setSelectedId(null)}
    />
  );

  const techCard = (position: (typeof technicians)[number]) => (
    <TechPinCard
      position={position}
      name={nameOf(position.userId)}
      address={addresses.get(position.userId)}
      jobs={techJobsToday(deals, position.userId, todayISO())}
      title={titleOf}
      clientName={clientOf}
      canReorder={canEdit}
      onReorder={(orderedDealIds) => reorder.mutate({ techId: position.userId, orderedDealIds })}
      onSelectJob={(id) => {
        setTab("jobs");
        select(id);
      }}
      onClose={() => setSelectedId(null)}
    />
  );

  const closedTicked = filters.statuses.some((s) => MAP_CLOSED_STATUSES.includes(s));
  const found =
    tab === "jobs"
      ? mapFoundText({
          shown: filtered.length,
          open: deals.length,
          closed: board.closedWindow ? closedDeals.length : undefined,
          closedNeedDays: closedTicked && !days.from,
        })
      : `Found ${people.length} users`;

  return (
    <div data-testid="dispatch-board" className="flex min-h-0 flex-1 bg-white pt-[14px]">
      <MapSidebar
        tab={tab}
        onTab={pickTab}
        showTabs={canSeeTechs}
        search={search}
        onSearch={(v) => patch({ search: v })}
        onSearchEnter={zoomToFirstMatch}
        onFilters={() => setFiltersOpen(true)}
        filtersPanel={
          filtersOpen ? (
            <MapFiltersPanel
              value={filters}
              techs={techOptions}
              areas={areaOptions}
              jobTypes={jobTypeOptions}
              onApply={(next) => {
                patch({ filters: next });
                setFiltersOpen(false);
              }}
              onBack={() => setFiltersOpen(false)}
            />
          ) : undefined
        }
        found={found}
        onRefresh={() => query.refetch()}
        refreshing={query.isFetching}
        refreshTitle={board.updatedAt ? `Last updated ${new Date(board.updatedAt).toLocaleTimeString()}` : undefined}
        toggles={
          <>
            {canSeeTechs ? (
              <MapToggleRow label="Show techs" checked={showTechs} onCheckedChange={(v) => patch({ showTechs: v })} />
            ) : null}
            {canSeeAreas ? (
              <MapToggleRow
                label="Show service areas"
                checked={showAreas}
                onCheckedChange={(v) => patch({ showAreas: v })}
              />
            ) : null}
          </>
        }
      >
        {board.failed ? (
          <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
            <TriangleAlert className="size-6 text-wz-danger" />
            <div>
              <p className="text-sm font-semibold text-foreground">Couldn&apos;t load jobs</p>
              <p className="text-xs text-muted-foreground">{getApiErrorMessage(query.error)}</p>
            </div>
            <Button variant="outline" onClick={() => query.refetch()}>
              Retry
            </Button>
          </div>
        ) : tab === "jobs" ? (
          <JobList
            mapped={mapped}
            unmapped={unmapped}
            title={titleOf}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            onSelect={select}
          />
        ) : techsReady ? (
          <TechList rows={people} addresses={addresses} hoveredId={hoveredId} onHover={setHoveredId} onSelect={select} />
        ) : (
          // Opened before the team (or its streets) answered: its rows land whole.
          <DispatchListSkeleton />
        )}
      </MapSidebar>

      <div className="relative min-w-0 flex-1">
        {/* Both are required: without a vector Map ID the map loads but
            draws no pins, which looks like a bug rather than a gap in setup. */}
        {env.googleMapsApiKey && env.googleMapsMapId ? (
          <>
            <DispatchMap
              deals={mapJobs}
              allDeals={deals}
              technicians={mapTechs}
              serviceAreas={mapAreas}
              fitTo={tab}
              jobTechNames={(d) => d.assignedTechIds.map(nameOf)}
              techName={nameOf}
              hoveredId={hoveredId}
              selectedId={selectedId}
              panTo={selectedPosition}
              panNonce={panNonce}
              onHover={setHoveredId}
              onSelect={select}
              jobCard={jobCard}
              techCard={techCard}
            />
            {tab === "jobs" ? (
              <MapDateBox
                range={range}
                anchor={anchor}
                onRange={(r) => patch({ range: r })}
                onStep={(step) => setAnchor((a) => shiftMapRange(range, a, step))}
                onReset={() => setAnchor(localToday())}
              />
            ) : null}
            <ServiceAreaLegend areas={mapAreas} />
          </>
        ) : (
          <MissingConfig missingKey={!env.googleMapsApiKey} missingMapId={!env.googleMapsMapId} />
        )}
      </div>

      {selectedDeal && editing ? <EditWholeJob dealId={selectedDeal.id} onOpenChange={setEditing} /> : null}
      {selectedDeal && assigning ? (
        <AssignTechDialog
          dealId={selectedDeal.id}
          assignedTechIds={selectedDeal.assignedTechIds}
          open
          onOpenChange={setAssigning}
        />
      ) : null}
    </div>
  );
}

/**
 * The edit sheet, on the WHOLE job. The map's rows are cut to what the map
 * draws (`GET /deals/map` sends no notes, money or custom answers), and the
 * sheet saves every field it shows — handed a map row it would save those
 * blank. So it opens once the job itself is read (`GET /deals/:id`, the same
 * cache the job page uses).
 */
function EditWholeJob({ dealId, onOpenChange }: { dealId: string; onOpenChange: (open: boolean) => void }) {
  const { data: deal } = useDeal(dealId);
  return deal ? <EditDealSheet deal={deal} open onOpenChange={onOpenChange} /> : null;
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
    <div className="flex size-full flex-col items-center justify-center gap-3 bg-muted p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-[8px] bg-wz-secondary-hover text-wz-slate">
        <KeyRound className="size-6" />
      </div>
      <div className="font-semibold text-foreground">The map needs Google Maps configuration</div>
      <ul className="max-w-sm space-y-1.5 text-sm text-wz-slate">
        {missingKey ? (
          <li>
            <code className="rounded-[3px] bg-wz-secondary-hover px-1">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> — a
            browser key with the Maps JavaScript and Places APIs enabled.
          </li>
        ) : null}
        {missingMapId ? (
          <li>
            <code className="rounded-[3px] bg-wz-secondary-hover px-1">NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID</code> — a{" "}
            <b>vector</b> Map ID from Map management. Job pins use AdvancedMarker, which draws
            nothing without one.
          </li>
        ) : null}
      </ul>
      <p className="text-xs text-wz-slate">
        Set them in <code className="rounded-[3px] bg-wz-secondary-hover px-1">apps/web/.env</code>. The job list
        works without either.
      </p>
    </div>
  );
}
