"use client";

import { useMemo, useState } from "react";
import { AlertCircle, Building, Loader2, Trash2 } from "lucide-react";
import type { BusinessProfileView } from "@bitcrm/types";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { WzButton } from "@/components/workiz/button";
import type { WzGridColumn } from "@/components/workiz/local-grid";
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzSettingsCatalog } from "@/components/workiz/settings-catalog";
import { WzSettingsHeader } from "@/components/workiz/settings-page";
import { usePermissions } from "@/features/auth/use-permissions";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { getApiErrorMessage } from "@/lib/api/errors";
import { formatPhone } from "@/lib/phone";
import {
  useBusinessProfiles,
  useDeleteBusinessProfile,
  useSetDefaultBusinessProfile,
  useUpdateBusinessProfile,
} from "../hooks";
import { CompanyFormDialog } from "./company-form-dialog";

const TITLE = "Companies";
const DESCRIPTION = "Your business companies — names, logos and details used on jobs, invoices and estimates.";
const DEFAULT_FIRST = "Make another company the default first";

/** The default first, then by name. */
const byCatalogOrder = (a: BusinessProfileView, b: BusinessProfileView) =>
  Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name);

/**
 * Settings → Companies, as a Workiz settings catalog (the External Companies /
 * Job Types pages): the band, "Show: Active" with "Add New Company", the grid
 * — Logo, Company Name, Phone, Email, Default, the ON/OFF Status switch
 * (archiving), the yellow Delete — and a row opening the company in Workiz's
 * Account page layout. Workiz keeps one account, so the list is ours; it
 * looks like its catalogs.
 */
export function CompaniesSettingsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const canEdit = can("settings", "edit");
  const companiesQuery = useBusinessProfiles();
  const { data, isError, error, refetch } = companiesQuery;
  // One skeleton until both the user and the companies are in: "Add New
  // Company" and the rows come in the same frame.
  const ready = usePageReady(!permsLoading && settled(companiesQuery));
  const setDefault = useSetDefaultBusinessProfile();

  const [formOpen, setFormOpen] = useState(false);
  // An id, not a snapshot: the dialog reads the live (refetched) company.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<BusinessProfileView | null>(null);

  const companies = useMemo(() => [...(data ?? [])].sort(byCatalogOrder), [data]);
  const editing = editingId ? data?.find((c) => c.id === editingId) : undefined;

  const open = (id: string | null) => {
    setEditingId(id);
    setFormOpen(true);
  };

  const columns = useMemo<WzGridColumn<BusinessProfileView>[]>(() => {
    const cols: WzGridColumn<BusinessProfileView>[] = [
      {
        id: "name",
        label: "Company Name",
        render: (c) => c.name,
        sortValue: (c) => c.name,
        searchText: (c) => c.name,
      },
      {
        id: "logo",
        label: "Logo",
        width: 160,
        render: (c) =>
          c.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL
            <img src={c.logoUrl} alt={`${c.name} logo`} className="block h-8 max-w-[120px] object-contain" />
          ) : null,
      },
      {
        id: "phone",
        label: "Phone",
        render: (c) => (c.phone ? formatPhone(c.phone) : ""),
        sortValue: (c) => c.phone,
        searchText: (c) => `${c.phone ?? ""} ${c.phone ? formatPhone(c.phone) : ""}`,
      },
      {
        id: "email",
        label: "Email",
        render: (c) => c.email ?? "",
        sortValue: (c) => c.email,
        searchText: (c) => c.email,
      },
      {
        id: "default",
        label: "Default",
        width: 170,
        render: (c) =>
          c.isDefault ? (
            <span className="font-semibold">Default</span>
          ) : canEdit && c.active ? (
            <WzButton
              variant="secondary"
              size="regular"
              aria-label={`Make ${c.name} the default`}
              onClick={(e) => {
                e.stopPropagation();
                setDefault.mutate(c.id);
              }}
            >
              Make Default
            </WzButton>
          ) : null,
      },
      {
        id: "status",
        label: "Status",
        width: 140,
        render: (c) => <CompanyStatusSwitch company={c} disabled={!canEdit || c.isDefault} />,
        sortValue: (c) => (c.active ? 1 : 0),
      },
    ];
    if (canEdit) {
      cols.push({
        id: "actions",
        label: "Actions",
        width: 150,
        render: (c) => (
          <WzButton
            size="regular"
            icon={<Trash2 />}
            aria-label={`Delete ${c.name}`}
            disabled={c.isDefault}
            title={c.isDefault ? DEFAULT_FIRST : undefined}
            // Workiz's held button: #eff1f1 with #9ea6aa words.
            className="disabled:bg-wz-disabled-fill disabled:hover:bg-wz-disabled-fill [&:disabled>span]:text-wz-outline"
            onClick={(e) => {
              e.stopPropagation();
              setDeleting(c);
            }}
          >
            Delete
          </WzButton>
        ),
      });
    }
    return cols;
  }, [canEdit, setDefault]);

  const dialogs = (
    <>
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
    </>
  );

  if (ready && isError) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <WzSettingsHeader icon={<Building />} title={TITLE} description={DESCRIPTION} />
        <div className="m-5 flex flex-col items-center gap-2 border border-wz-frame p-8 text-center">
          <AlertCircle className="size-6 text-wz-danger" />
          <p className="text-sm">{getApiErrorMessage(error, "Couldn't load companies")}</p>
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <WzSettingsCatalog<BusinessProfileView>
      icon={<Building />}
      title={TITLE}
      description={DESCRIPTION}
      label="Companies"
      ready={ready}
      rows={companies}
      rowKey={(c) => c.id}
      columns={columns}
      isActive={(c) => c.active}
      onAdd={canEdit ? () => open(null) : undefined}
      addLabel="Add New Company"
      onOpen={(c) => open(c.id)}
      openLabel={(c) => `${canEdit ? "Edit" : "View"} ${c.name}`}
    >
      {dialogs}
    </WzSettingsCatalog>
  );
}

/**
 * The row's Status switch: off archives the company (it leaves the pickers,
 * old jobs keep it), on brings it back. The default company stays on.
 * It shows the state asked for while the save is on its way.
 */
function CompanyStatusSwitch({ company, disabled }: { company: BusinessProfileView; disabled: boolean }) {
  const update = useUpdateBusinessProfile();
  const pending = update.isPending ? (update.variables?.body as { active?: boolean } | undefined)?.active : undefined;
  return (
    <WzOnOffSwitch
      aria-label={`${company.name} status`}
      title={company.isDefault ? "The default company is always active" : undefined}
      checked={pending ?? company.active}
      disabled={disabled || update.isPending}
      onCheckedChange={(active) => update.mutate({ id: company.id, body: { active } })}
    />
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
            Jobs that used this company keep its name. Consider switching it off instead — it hides the company from
            pickers without deleting it.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error ? (
          <p className="flex items-start gap-1.5 text-sm leading-[21px] text-wz-error" role="alert">
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
