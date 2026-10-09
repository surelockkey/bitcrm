"use client";

import { useMemo, useState } from "react";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import type { ExternalCompany } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WzDataTable } from "@/components/workiz/data-table";
import { formatPhone } from "@/features/clients/lib";
import { usePermissions } from "@/features/auth/use-permissions";
import { cn } from "@/lib/utils";
import { settled, usePageReady } from "@/lib/use-page-ready";
import {
  useExternalCompanies,
  useDeleteExternalCompany,
  useToggleExternalCompany,
} from "../hooks";
import { searchExternalCompanies, sortExternalCompanies, type ExternalCompanySortKey } from "../lib";
import { ExternalCompanyFormDialog } from "./external-company-form-dialog";

const COLUMNS: { key: ExternalCompanySortKey | "actions"; label: string }[] = [
  { key: "name", label: "company name" },
  { key: "email", label: "company email" },
  { key: "address", label: "company address" },
  { key: "phone", label: "company phone" },
  { key: "status", label: "status" },
  { key: "actions", label: "Actions" },
];

/*
 * Workiz's legacy `a.button`s (pg_settings_catalogs_wz_companies_frame):
 * #ffd400, 13px/600 #404040, 0 15px, 0.5px tracking, 32px — square-cornered
 * (2px) for "Add New Company", round (15px) for the row's "Disable/Enable"
 * and pencil. #ffd400 is the legacy pages' yellow (wz-focus).
 */
const LEGACY_BUTTON =
  "inline-flex h-8 shrink-0 items-center justify-center bg-wz-focus px-[15px] text-[13px] leading-8 font-semibold tracking-[0.5px] text-wz-strong outline-none hover:bg-wz-primary-hover focus-visible:ring-2 focus-visible:ring-wz-strong/40 disabled:cursor-not-allowed disabled:opacity-60";

/**
 * Settings → External Companies, as Workiz's (`/root/companies/`, a legacy
 * page in a frame — pg_settings_catalogs_wz_companies): no band, the square
 * yellow "Add New Company", then DataTables' grid — the #f7f7f7 strip with
 * the "search" box at the right, company name / email / address / phone /
 * status / Actions, sorted by name (▼, the column #f1f1f1), each row's
 * yellow "Disable/Enable" and pencil — and "Showing 1 to 33 of 33 entries"
 * under it. Delete is ours, a third yellow button after the pencil.
 */
export function ExternalCompaniesPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const companiesQuery = useExternalCompanies();
  const companies = companiesQuery.data;
  // One skeleton until both the user and the list are in: "Add New Company"
  // and the rows come in the same frame, and nobody is refused for the beat
  // their permissions are still on the way.
  const ready = usePageReady(!permsLoading && settled(companiesQuery));
  const del = useDeleteExternalCompany();
  const toggle = useToggleExternalCompany();

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: ExternalCompanySortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalCompany | undefined>();
  const [deleting, setDeleting] = useState<ExternalCompany | undefined>();

  const canCreate = can("external_companies", "create");
  const canEdit = can("external_companies", "edit");
  const canDelete = can("external_companies", "delete");

  const rows = useMemo(
    () => sortExternalCompanies(searchExternalCompanies(companies, search), sort),
    [companies, search, sort],
  );

  if (!permsLoading && !can("external_companies", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view external companies.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (company: ExternalCompany) => {
    setEditing(company);
    setFormOpen(true);
  };
  const onSort = (key: string) => {
    if (key === "actions") return;
    setSort((s) => (s.key === key ? { key: s.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: key as ExternalCompanySortKey, dir: "asc" }));
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col pt-[13px]">
      <h2 className="sr-only">External Companies</h2>
      {!ready ? (
        <div className="px-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <>
          <div className="flex h-8 px-5">
            {canCreate ? (
              <button type="button" onClick={openNew} className={cn(LEGACY_BUTTON, "rounded-[2px]")}>
                Add New Company
              </button>
            ) : null}
          </div>
          <WzDataTable
            aria-label="External companies"
            className="mt-7"
            columns={COLUMNS}
            sort={sort}
            onSort={onSort}
            search={{ value: search, onChange: setSearch, label: "Search external companies" }}
            rows={rows.map((company) => ({
              key: company.id,
              cells: [
                company.name,
                company.email || "",
                company.address || "",
                company.phone ? formatPhone(company.phone) : "",
                company.active ? "Enabled" : "Disabled",
                <div key="actions" className="flex items-center gap-px">
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={company.active ? "Disable" : "Enable"}
                      title={company.active ? "Disable" : "Enable"}
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate({ id: company.id, active: !company.active })}
                      className={cn(LEGACY_BUTTON, "rounded-[15px]")}
                    >
                      Disable/Enable
                    </button>
                  ) : null}
                  {canEdit ? (
                    <button
                      type="button"
                      aria-label={`Edit ${company.name}`}
                      title="Edit"
                      onClick={() => openEdit(company)}
                      className={cn(LEGACY_BUTTON, "w-[39px] rounded-[15px] px-0")}
                    >
                      <Pencil className="size-3" strokeWidth={2.5} />
                    </button>
                  ) : null}
                  {canDelete ? (
                    <button
                      type="button"
                      aria-label={`Delete ${company.name}`}
                      title="Delete"
                      onClick={() => setDeleting(company)}
                      className={cn(LEGACY_BUTTON, "w-[39px] rounded-[15px] px-0")}
                    >
                      <Trash2 className="size-3" strokeWidth={2.5} />
                    </button>
                  ) : null}
                </div>,
              ],
            }))}
          />
          {/* DataTables' info line: 14px/30px, 10px all round. */}
          <p className="p-2.5 text-sm leading-[30px] text-wz-strong">
            {rows.length === 0 ? "Showing 0 to 0 of 0 entries" : `Showing 1 to ${rows.length} of ${rows.length} entries`}
            {search && companies && rows.length !== companies.length ? ` (filtered from ${companies.length} total entries)` : ""}
          </p>
        </>
      )}

      {formOpen ? (
        <ExternalCompanyFormDialog
          key={editing?.id ?? "new"}
          company={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete external company?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.name}&rdquo; will be removed. If any job still references it,
              it&apos;s disabled instead — it leaves the pickers but old jobs keep their label.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) del.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) });
              }}
            >
              {del.isPending ? <Loader2 className="size-4 animate-spin" /> : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
