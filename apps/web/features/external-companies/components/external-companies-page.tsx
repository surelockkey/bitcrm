"use client";

import { useMemo, useState } from "react";
import { Building2, Loader2, Pencil, Plus, Search, Trash2 } from "lucide-react";
import type { ExternalCompany } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { formatPhone } from "@/features/clients/lib";
import { usePermissions } from "@/features/auth/use-permissions";
import {
  useExternalCompanies,
  useDeleteExternalCompany,
  useToggleExternalCompany,
} from "../hooks";
import { searchExternalCompanies } from "../lib";
import { ExternalCompanyFormDialog } from "./external-company-form-dialog";

export function ExternalCompaniesPage() {
  const { can } = usePermissions();
  const { data: companies, isLoading } = useExternalCompanies();
  const del = useDeleteExternalCompany();
  const toggle = useToggleExternalCompany();

  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExternalCompany | undefined>();
  const [deleting, setDeleting] = useState<ExternalCompany | undefined>();

  const canCreate = can("external_companies", "create");
  const canEdit = can("external_companies", "edit");
  const canDelete = can("external_companies", "delete");

  const rows = useMemo(
    () => searchExternalCompanies(companies, search),
    [companies, search],
  );

  if (!can("external_companies", "view")) {
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">External companies</h2>
          <p className="text-sm text-muted-foreground">
            Partners that send you work. A job can record which one referred it.
          </p>
        </div>
        {canCreate ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={openNew}>
            <Plus className="size-4" /> New company
          </Button>
        ) : null}
      </div>

      <div className="relative max-w-sm">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          className="h-9 pl-8"
          placeholder="Search name, email, address, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search external companies"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : !companies || companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Building2 className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No external companies yet</p>
          <p className="text-sm text-muted-foreground">
            Add the partners that send you work so jobs can record where they came from.
          </p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border border-dashed py-14 text-center text-sm text-muted-foreground">
          No company matches &ldquo;{search}&rdquo;.
        </div>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company name</TableHead>
                <TableHead>Company email</TableHead>
                <TableHead>Company address</TableHead>
                <TableHead>Company phone</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-40 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((company) => (
                <TableRow key={company.id}>
                  <TableCell className="font-medium">{company.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {company.email || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {company.address || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {company.phone ? formatPhone(company.phone) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={company.active ? "default" : "secondary"}>
                      {company.active ? "Enabled" : "Disabled"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {canEdit ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8"
                          disabled={toggle.isPending}
                          onClick={() =>
                            toggle.mutate({ id: company.id, active: !company.active })
                          }
                        >
                          {company.active ? "Disable" : "Enable"}
                        </Button>
                      ) : null}
                      {canEdit ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => openEdit(company)}
                          aria-label={`Edit ${company.name}`}
                        >
                          <Pencil className="size-4" />
                        </Button>
                      ) : null}
                      {canDelete ? (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={() => setDeleting(company)}
                          aria-label={`Delete ${company.name}`}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
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
