"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Plus, UsersRound } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzFilterSelect, type WzFilterPick } from "@/components/workiz/filter-select";
import { localGridView, nextGridSort, WZ_GRID_PAGE_SIZES, type WzGridColumn, type WzGridSort } from "@/components/workiz/local-grid";
import { WzPager } from "@/components/workiz/pager";
import type { WzRowOpenEvent } from "@/components/workiz/report-grid";
import { WzSettingsExplain } from "@/components/workiz/settings-explain";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { usePermissions } from "@/features/auth/use-permissions";
import { useJobTypeName, useJobTypesLoading } from "@/features/job-types/lib";
import { useRoles } from "@/features/roles/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { CreateUserSheet } from "@/features/users/components/create-user-sheet";
import { usePageSize } from "@/lib/paging/use-page-size";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useApprovedAssignments, usePendingAssignments, useTechnicians, useUserMap } from "../hooks";
import { DEFAULT_TEAM_FILTER, filterTeam, NO_APPROVED, teamFilterGroups, teamRows, type TeamRow } from "../team-list";
import { AssignmentsQueueDialog } from "./assignments-queue-dialog";
import { TEAM_COLUMNS, TechniciansTable } from "./technicians-table";

/** The grid's columns as `localGridView` reads them: how each sorts and what Search looks in. */
const VIEW_COLUMNS: WzGridColumn<TeamRow>[] = TEAM_COLUMNS.map((c) => ({
  id: c.id,
  label: c.label,
  render: c.cell,
  sortValue: c.sortValue,
  searchText: c.searchText,
}));

const NO_ROWS: TeamRow[] = [];

/**
 * The technicians list as Workiz's Team page (`/root/team`,
 * pg_technicians_wz_01_team): the settings band, "Filter results" opening on
 * "status: Active" with "+ Add New" beside it, the grey strip with Search and
 * the page size, the Team grid, Workiz's pager.
 *
 * Every technician is read (the list is small and Workiz searches, sorts and
 * filters by role and area, which the paged endpoint cannot), with the
 * directory, the role names and every approved job type and area, and the
 * page shows once all of it is in.
 */
export function TechniciansPage() {
  const router = useRouter();
  const { can, isLoading: permsLoading } = usePermissions();
  const canApprove = can("job_types", "approve");
  const canReadRoles = can("roles", "view");
  const canReadAssignments = can("job_types", "view") || can("service_areas", "view");
  const canAddUsers = can("users", "create");

  const techs = useTechnicians(undefined, true);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = techs;
  useEffect(() => {
    // Every page of profiles: the list searches and filters all of them.
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const userMapQuery = useUserMap();
  const rolesQuery = useRoles(!permsLoading && canReadRoles);
  const approvedQuery = useApprovedAssignments(!permsLoading && canReadAssignments);
  const areasQuery = useServiceAreas();
  const jobTypesLoading = useJobTypesLoading();
  const jobTypeName = useJobTypeName();
  const pendingQuery = usePendingAssignments(canApprove);

  const allIn =
    !permsLoading &&
    [techs, userMapQuery, rolesQuery, approvedQuery, areasQuery, pendingQuery].every(settled) &&
    !jobTypesLoading &&
    hasNextPage !== true;
  const ready = usePageReady(allIn);

  const [picks, setPicks] = useState<WzFilterPick[]>(DEFAULT_TEAM_FILTER);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>({ id: "name", dir: "asc" });
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize("technicians", { sizes: WZ_GRID_PAGE_SIZES, fallback: 10 });
  const [queueOpen, setQueueOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const roles = useMemo(() => rolesQuery.data ?? [], [rolesQuery.data]);
  const areas = useMemo(() => areasQuery.data ?? [], [areasQuery.data]);
  const rows = useMemo(() => {
    const profiles = techs.data?.pages.flatMap((p) => p.data) ?? [];
    const areaName = (id: string) => areas.find((a) => a.id === id)?.name ?? "";
    return teamRows(profiles, {
      users: userMapQuery.data ?? new Map(),
      roles,
      approved: approvedQuery.data ?? NO_APPROVED,
      jobTypeName: (id) => jobTypeName(id),
      areaName,
    });
    // jobTypeName is rebuilt each render; its catalog is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [techs.data, userMapQuery.data, roles, approvedQuery.data, areas, jobTypesLoading]);

  const groups = useMemo(() => teamFilterGroups({ roles, areas }), [roles, areas]);
  const view = useMemo(
    () => localGridView(filterTeam(rows, picks), VIEW_COLUMNS, { query, sort, page, size }),
    [rows, picks, query, sort, page, size],
  );

  const pending = pendingQuery.data;
  const pendingCount = (pending?.jobTypes.length ?? 0) + (pending?.serviceAreas.length ?? 0);

  if (!permsLoading && !can("technicians", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view technicians.</p>
      </div>
    );
  }

  const open = (row: TeamRow, event: WzRowOpenEvent) => {
    const href = `/technicians/${row.id}`;
    const newTab = "button" in event && (event.metaKey || event.ctrlKey || event.button === 1);
    if (newTab) window.open(href, "_blank", "noopener");
    else router.push(href);
  };

  return (
    <div className="flex flex-1 flex-col">
      <WzSettingsExplain icon={<UsersRound />} title="Technicians">
        Field team — onboarding, skills, commission, and paperwork.
      </WzSettingsExplain>

      {/* The filter row (pg_technicians_wz_01_team): Filter results two thirds
          wide from 21px in, "+ Add New" 31px after it, 20px under the band and
          36px over the strip. */}
      <div className="flex items-start pt-5 pb-9">
        <div className="ml-[21px] w-[calc(66.666%-37px)] min-w-0">
          {ready ? (
            <WzFilterSelect
              groups={groups}
              value={picks}
              onChange={(next) => {
                setPicks(next);
                setPage(1);
              }}
            />
          ) : (
            <Skeleton className="h-[38px] w-full" />
          )}
        </div>
        <div className="ml-[31px] flex flex-wrap items-center gap-3">
          {canAddUsers ? (
            <WzButton size="regular" icon={<Plus className="size-[18px]" strokeWidth={2.5} />} onClick={() => setAddOpen(true)}>
              Add New
            </WzButton>
          ) : null}
          {/* Ours: the review queue of proposed job types and areas, styled as
              Workiz's secondary button beside its primary one. */}
          {ready && canApprove && pendingCount > 0 ? (
            <WzButton
              variant="secondary"
              size="regular"
              icon={<ClipboardCheck className="size-4" />}
              onClick={() => setQueueOpen(true)}
            >
              {pendingCount} assignment{pendingCount === 1 ? "" : "s"} awaiting review
            </WzButton>
          ) : null}
        </div>
      </div>

      <WzListToolbar>
        <WzSearchBox
          // A search box without the browser's own blue × beside Workiz's round one.
          role="searchbox"
          value={query}
          onChange={(v) => {
            setQuery(v);
            setPage(1);
          }}
        />
        <WzPageSizeSelect
          className="ml-auto"
          value={size}
          sizes={WZ_GRID_PAGE_SIZES}
          onChange={(n) => {
            setSize(n);
            setPage(1);
          }}
        />
      </WzListToolbar>

      {ready && techs.isError ? (
        <div className="border border-wz-frame px-5 py-10 text-center text-sm text-wz-strong">
          <p role="alert">Couldn&apos;t load technicians</p>
          <WzButton variant="secondary" size="regular" className="mt-3" onClick={() => techs.refetch()}>
            Try again
          </WzButton>
        </div>
      ) : (
        <TechniciansTable
          rows={ready ? view.rows : NO_ROWS}
          sort={sort ? { column: sort.id, dir: sort.dir } : null}
          onSort={(column) => {
            setSort((s) => nextGridSort(s, column));
            setPage(1);
          }}
          onOpen={open}
          loading={!ready}
          footer={
            ready ? (
              <WzPager
                plainNumbers
                pager={{
                  page: view.page,
                  from: view.from,
                  to: view.to,
                  total: view.total,
                  totalPages: view.pages,
                  canPrev: view.page > 1,
                  canNext: view.page < view.pages,
                  isFetching: false,
                  prev: () => setPage(view.page - 1),
                  next: () => setPage(view.page + 1),
                }}
              />
            ) : null
          }
        />
      )}

      <AssignmentsQueueDialog open={queueOpen} onOpenChange={setQueueOpen} userMap={userMapQuery.data ?? new Map()} />
      {/* Workiz's "Add New" adds a person to the team; ours is the Users page's
          own sheet, mounted only when asked for so the list loads nothing extra. */}
      {addOpen ? <CreateUserSheet open onOpenChange={setAddOpen} /> : null}
    </div>
  );
}
