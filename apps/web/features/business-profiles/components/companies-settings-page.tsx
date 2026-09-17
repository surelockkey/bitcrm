"use client";

import { useState } from "react";
import {
  AlertCircle,
  Archive,
  ArchiveRestore,
  Building,
  Eye,
  Loader2,
  Mail,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Star,
  Trash2,
} from "lucide-react";
import type { BusinessProfileView } from "@bitcrm/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePermissions } from "@/features/auth/use-permissions";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";
import {
  useBusinessProfiles,
  useDeleteBusinessProfile,
  useSetDefaultBusinessProfile,
  useUpdateBusinessProfile,
} from "../hooks";
import { CompanyFormDialog } from "./company-form-dialog";

/** Settings → Companies: the brands jobs, invoices and estimates are issued under. */
export function CompaniesSettingsPage() {
  const { can } = usePermissions();
  const canEdit = can("settings", "edit");
  const { data, isLoading, isError, error, refetch } = useBusinessProfiles();
  const setDefault = useSetDefaultBusinessProfile();
  const update = useUpdateBusinessProfile();

  const [formOpen, setFormOpen] = useState(false);
  // An id, not a snapshot: the dialog reads the live (refetched) company.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BusinessProfileView | null>(null);

  const companies = [...(data ?? [])].sort(
    (a, b) =>
      Number(b.active) - Number(a.active) ||
      Number(b.isDefault) - Number(a.isDefault) ||
      a.name.localeCompare(b.name),
  );
  const editing = editingId ? data?.find((c) => c.id === editingId) : undefined;

  const open = (id: string | null) => {
    setEditingId(id);
    setFormOpen(true);
  };

  const setActive = (c: BusinessProfileView, active: boolean) =>
    update.mutate({ id: c.id, body: { active } });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Companies</h2>
          <p className="text-sm text-muted-foreground">
            Your business companies — names, logos and details used on jobs, invoices and estimates.
          </p>
        </div>
        {canEdit ? (
          <Button variant="brand" className="h-9 gap-1.5" onClick={() => open(null)}>
            <Plus className="size-4" /> Add company
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-8 text-center">
          <AlertCircle className="size-6 text-destructive" />
          <p className="text-sm">{getApiErrorMessage(error, "Couldn't load companies")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      ) : companies.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed py-14 text-center">
          <Building className="size-6 text-muted-foreground" />
          <p className="text-sm font-medium">No companies yet</p>
          <p className="text-sm text-muted-foreground">Add the business your documents are issued under.</p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {companies.map((c) => (
            <CompanyCard
              key={c.id}
              company={c}
              canEdit={canEdit}
              onOpen={() => open(c.id)}
              onSetDefault={() => setDefault.mutate(c.id)}
              onSetActive={(active) => setActive(c, active)}
              onDelete={() => setDeleting(c)}
            />
          ))}
        </div>
      )}

      <CompanyFormDialog
        company={editing}
        open={formOpen}
        onOpenChange={(v) => {
          setFormOpen(v);
          if (!v) setEditingId(null);
        }}
        canEdit={canEdit}
      />

      <DeleteCompanyDialog company={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}

function CompanyCard({
  company: c,
  canEdit,
  onOpen,
  onSetDefault,
  onSetActive,
  onDelete,
}: {
  company: BusinessProfileView;
  canEdit: boolean;
  onOpen: () => void;
  onSetDefault: () => void;
  onSetActive: (active: boolean) => void;
  onDelete: () => void;
}) {
  const titleId = `company-${c.id}-name`;
  return (
    <article
      aria-labelledby={titleId}
      className={cn(
        "flex items-start gap-3 rounded-xl border bg-card p-3 transition-shadow hover:shadow-sm",
        !c.active && "opacity-70",
      )}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${canEdit ? "Edit" : "View"} ${c.name}`}
        className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <div className="flex size-14 flex-none items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
          {c.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL
            <img src={c.logoUrl} alt={`${c.name} logo`} className="max-h-full max-w-full object-contain" />
          ) : (
            <Building className="size-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span id={titleId} className="truncate text-sm font-medium">
              {c.name}
            </span>
            {c.isDefault ? (
              <Badge variant="secondary" className="h-5 gap-1 px-1.5 text-[10px]">
                <Star className="size-3" /> Default
              </Badge>
            ) : null}
            {!c.active ? (
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                Archived
              </Badge>
            ) : null}
          </div>
          {c.phone ? (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Phone className="size-3 flex-none" /> {formatPhone(c.phone)}
            </p>
          ) : null}
          {c.email ? (
            <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Mail className="size-3 flex-none" /> {c.email}
            </p>
          ) : null}
          {!c.phone && !c.email ? <p className="text-xs text-muted-foreground">No contact details</p> : null}
        </div>
      </button>
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${c.name}`}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onSelect={onOpen}>
              <Pencil /> Edit
            </DropdownMenuItem>
            {!c.isDefault && c.active ? (
              <DropdownMenuItem onSelect={onSetDefault}>
                <Star /> Set as default
              </DropdownMenuItem>
            ) : null}
            {c.active ? (
              <DropdownMenuItem
                disabled={c.isDefault}
                onSelect={() => onSetActive(false)}
                title={c.isDefault ? "Make another company the default first" : undefined}
              >
                <Archive /> Archive
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onSelect={() => onSetActive(true)}>
                <ArchiveRestore /> Restore
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              disabled={c.isDefault}
              onSelect={onDelete}
              title={c.isDefault ? "Make another company the default first" : undefined}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        <Eye className="mt-1 size-4 flex-none text-muted-foreground" aria-hidden />
      )}
    </article>
  );
}

function DeleteCompanyDialog({ company, onClose }: { company: BusinessProfileView | null; onClose: () => void }) {
  const del = useDeleteBusinessProfile();
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setError(null);
    del.reset();
    onClose();
  };
  return (
    <AlertDialog open={!!company} onOpenChange={(v) => !v && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {company?.name}?</AlertDialogTitle>
          <AlertDialogDescription>
            Jobs that used this company keep its name. Consider archiving instead — it hides the company from pickers
            without deleting it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
            <AlertCircle className="mt-0.5 size-4 flex-none" />
            {error}
          </p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            className="gap-1.5"
            disabled={del.isPending || !company}
            onClick={() => {
              if (!company) return;
              setError(null);
              del.mutate(company.id, {
                onSuccess: close,
                onError: (e) => setError(getApiErrorMessage(e, "Couldn't delete the company")),
              });
            }}
          >
            {del.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            Delete company
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
