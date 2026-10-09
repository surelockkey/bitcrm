"use client";

import { useMemo, useState, type MouseEvent } from "react";
import { Bell, Plus } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WzButton } from "@/components/workiz/button";
import { WzTrashIcon } from "@/components/workiz/icons";
import { WZ_GRID_PAGE_SIZES, localGridView, type WzGridColumn, type WzGridSort } from "@/components/workiz/local-grid";
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzPager } from "@/components/workiz/pager";
import { WzReportGrid, wzNextSort, type WzReportColumn } from "@/components/workiz/report-grid";
import { WzSettingsBar, WzSettingsHeader } from "@/components/workiz/settings-page";
import { WzListToolbar, WzPageSizeSelect, WzSearchBox } from "@/components/workiz/toolbar";
import { useUpdateAutomation } from "@/features/automations/hooks";
import { useJobSources } from "@/features/job-sources/hooks";
import { useJobStatuses } from "@/features/job-statuses/hooks";
import { useJobTypes } from "@/features/job-types/hooks";
import { useShortCodes } from "@/features/messaging/hooks";
import { useServiceAreas } from "@/features/service-areas/hooks";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { cn } from "@/lib/utils";
import { useActiveUsers, useNotificationRules, useNotificationsAccess } from "../hooks";
import {
  UNKNOWN_USER,
  describeNotification,
  fromSpec,
  notifyByCell,
  type DescriptionPart,
  type NotificationForm,
  type NotificationNames,
  type NotificationRule,
} from "../lib";
import { NotificationDeleteDialog } from "./notification-delete-dialog";
import { NotificationEditor, type EditorCatalogs } from "./notification-editor";

const TITLE = "Auto Notifications";
const DESCRIPTION = "Create auto-notifications and reminders for you, your team and clients";

/** One row of the grid, every cell worked out once. */
interface Row {
  id: string;
  rule: NotificationRule;
  form: NotificationForm;
  who: { label: string; email?: string };
  notifyBy: string;
  parts: DescriptionPart[];
  text: string;
}

/** The Notify cell: "Assigned client" / "Assigned tech", or the user's name with the e-mail under it. */
function whoOf(form: NotificationForm, names: NotificationNames): Row["who"] {
  switch (form.kind) {
    case "client_reminder":
      return { label: "Assigned client" };
    case "tech_reminder":
      return { label: "Assigned tech" };
    case "call_alert":
    case "user_status_alert": {
      const people = form.userIds.map((id) => names.users[id]);
      const label = people.map((p) => p?.name ?? UNKNOWN_USER).join(", ") || UNKNOWN_USER;
      return { label, email: people.length === 1 ? people[0]?.email : undefined };
    }
  }
}

/**
 * Settings → Notifications: Workiz's Notification Center
 * (`/root/notification_center`, notif_audit_wz_02_loaded) — the "Auto
 * Notifications" band, "Add New", the Search / page-size strip, and the
 * react-table grid: Notify 170 · Notify By 100 · Description · Actions 260
 * (the round trash and the ON/OFF switch), 72px rows, the pager inside the
 * frame. Every row is an automation rule of the notification category, and
 * its Description is Workiz's own sentence (`describeNotification`). A row
 * opens its kind's editor; "Add New" opens the four-form editor.
 *
 * One skeleton until the rules, the people they name and the catalogs the
 * editor lists are in; then the whole page in one frame (lib/use-page-ready).
 */
export function NotificationsPage() {
  const { canView, canEdit, isLoading: accessLoading } = useNotificationsAccess();
  const { query: rulesQuery, rules } = useNotificationRules(canView);
  const { query: usersQuery, users, allIn: usersIn } = useActiveUsers();
  const statusesQuery = useJobStatuses();
  const sourcesQuery = useJobSources();
  const typesQuery = useJobTypes();
  const areasQuery = useServiceAreas(canView);
  const codesQuery = useShortCodes(canView);
  const update = useUpdateAutomation();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<WzGridSort | null>(null);
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<NotificationRule | undefined>();
  const [deleting, setDeleting] = useState<Row | undefined>();

  const names = useMemo<NotificationNames>(
    () => ({
      users: Object.fromEntries(users.map((u) => [u.id, { name: u.name, email: u.email }])),
      statuses: Object.fromEntries((statusesQuery.data ?? []).map((s) => [s.id, s.name])),
    }),
    [users, statusesQuery.data],
  );

  const rows = useMemo<Row[]>(
    () =>
      rules.flatMap((rule) => {
        const form = rule.spec ? fromSpec(rule.spec) : null;
        if (!form) return [];
        const parts = describeNotification(rule, names);
        return [
          {
            id: rule.id,
            rule,
            form,
            who: whoOf(form, names),
            notifyBy: notifyByCell(form.notifyBy),
            parts,
            text: parts.map((p) => p.text).join(""),
          },
        ];
      }),
    [rules, names],
  );

  const ready = usePageReady(
    !accessLoading &&
      settled(rulesQuery) &&
      usersIn &&
      settled(usersQuery) &&
      [statusesQuery, sourcesQuery, typesQuery, areasQuery, codesQuery].every(settled),
  );

  const columns = useMemo<WzGridColumn<Row>[]>(
    () => [
      {
        id: "notify",
        label: "Notify",
        width: 170,
        render: (r) => (
          <>
            <span className={cn(r.who.email && "capitalize")}>{r.who.label}</span>
            {r.who.email ? (
              // Workiz's `small`: 11px/13px #999, 3px under the name.
              <small className="mt-[3px] block overflow-hidden text-[11px] leading-[13px] font-normal text-ellipsis text-wz-caption">
                {r.who.email}
              </small>
            ) : null}
          </>
        ),
        sortValue: (r) => r.who.label,
        searchText: (r) => `${r.who.label} ${r.who.email ?? ""}`,
      },
      {
        id: "notifyBy",
        label: "Notify By",
        width: 100,
        render: (r) => r.notifyBy,
        sortValue: (r) => r.notifyBy,
        searchText: (r) => r.notifyBy,
      },
      {
        id: "description",
        label: "Description",
        render: (r) => (
          <span>
            {r.parts.map((p, i) => (p.bold ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
          </span>
        ),
        sortValue: (r) => r.text,
        searchText: (r) => r.text,
      },
      {
        id: "actions",
        label: "Actions",
        width: 260,
        render: (r) => (
          <span className="flex items-start">
            {/* Workiz's `icon-trash roundBtn`: 30×32, round, 1px #666 on #efefef, 16px into the cell and 4px above its padding. */}
            <button
              type="button"
              aria-label={`Delete: ${r.text}`}
              disabled={!canEdit}
              onClick={(e: MouseEvent) => {
                e.stopPropagation();
                setDeleting(r);
              }}
              className="-mt-1 ml-4 grid h-8 w-[30px] shrink-0 cursor-pointer place-items-center rounded-full border border-wz-text bg-[#efefef] text-wz-text outline-none hover:bg-wz-disc-hover focus-visible:ring-2 focus-visible:ring-wz-focus disabled:cursor-not-allowed disabled:opacity-60"
            >
              <WzTrashIcon size={16} />
            </button>
            <WzOnOffSwitch
              className="ml-4"
              aria-label={`${r.text} — on or off`}
              checked={r.rule.enabled}
              disabled={!canEdit || update.isPending}
              onCheckedChange={(enabled) => update.mutate({ id: r.rule.id, body: { enabled } })}
            />
          </span>
        ),
      },
    ],
    [canEdit, update],
  );

  const view = useMemo(() => localGridView(rows, columns, { query: search, sort, page, size }), [rows, columns, search, sort, page, size]);
  const gridColumns = useMemo<WzReportColumn<Row>[]>(
    () => columns.map((c) => ({ id: c.id, label: c.label, width: c.width, sortable: !!c.sortValue, cell: c.render })),
    [columns],
  );

  const catalogs = useMemo<EditorCatalogs>(
    () => ({
      users,
      statuses: statusesQuery.data ?? [],
      sources: sourcesQuery.data ?? [],
      types: typesQuery.data ?? [],
      areas: areasQuery.data ?? [],
      shortCodes: codesQuery.data ?? [],
    }),
    [users, statusesQuery.data, sourcesQuery.data, typesQuery.data, areasQuery.data, codesQuery.data],
  );

  // Refused only once the permissions say so — not while they are coming.
  if (!accessLoading && !canView) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-semibold">No access</h2>
        <p className="text-sm text-muted-foreground">You don&apos;t have permission to view notifications.</p>
      </div>
    );
  }

  return (
    <div data-slot="notifications-page" className="flex min-w-0 flex-1 flex-col">
      <WzSettingsHeader icon={<Bell />} title={TITLE} description={DESCRIPTION} />
      {!ready ? (
        <div className="px-5 pt-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <>
          {/* "Add New" 20px under the band, the strip 28px under it (notif_audit_wz_02_loaded: y220 / y280). */}
          <WzSettingsBar
            className="pb-7"
            action={
              canEdit ? (
                <WzButton size="regular" icon={<Plus strokeWidth={1.75} />} onClick={() => setCreating(true)}>
                  Add New
                </WzButton>
              ) : null
            }
          />
          <WzListToolbar>
            <WzSearchBox
              aria-label="Search notifications"
              value={search}
              onChange={(v) => {
                setSearch(v);
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
          <WzReportGrid<Row>
            aria-label="Auto notifications"
            columns={gridColumns}
            rows={view.rows}
            rowKey={(r) => r.id}
            sort={sort ? { column: sort.id, dir: sort.dir } : null}
            onSort={(id) => {
              setSort((s) => ({ id, dir: wzNextSort(s?.id === id ? s.dir : undefined) }));
              setPage(1);
            }}
            rowHeight={72}
            stickyHeader={false}
            onRowClick={canEdit ? (r) => setEditing(r.rule) : undefined}
            footer={
              <WzPager
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
            }
          />
        </>
      )}

      {creating || editing ? (
        // Keyed by the rule: the editor reads the rule into its form once, as it mounts.
        <NotificationEditor
          key={editing?.id ?? "new"}
          open
          rule={editing}
          catalogs={catalogs}
          onOpenChange={(open) => {
            if (open) return;
            setCreating(false);
            setEditing(undefined);
          }}
        />
      ) : null}
      {deleting ? (
        <NotificationDeleteDialog
          id={deleting.id}
          description={deleting.text}
          open
          onOpenChange={(open) => !open && setDeleting(undefined)}
        />
      ) : null}
    </div>
  );
}
