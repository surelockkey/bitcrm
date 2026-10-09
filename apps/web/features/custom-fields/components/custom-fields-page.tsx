"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ClipboardList, Loader2, Plus, Trash2 } from "lucide-react";
import type { CustomFieldDefinition, CustomFieldType } from "@bitcrm/types";
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
import { WzButton } from "@/components/workiz/button";
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzSettingsBar, WzSettingsHeader } from "@/components/workiz/settings-page";
import { usePermissions } from "@/features/auth/use-permissions";
import { useJobTypes } from "@/features/job-types/hooks";
import { cn } from "@/lib/utils";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useCustomFields, useDeleteCustomField, useUpdateCustomField } from "../hooks";
import { groupFields } from "../lib";
import { CustomFieldFormDialog } from "./custom-field-form-dialog";

/** The Type column's words, Workiz's (capitalised by the cell): "Drop Down", "Files". */
const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "text",
  large_text: "large text",
  number: "number",
  checkbox: "checkbox",
  dropdown: "drop down",
  date: "date",
  file: "files",
  multi_select: "multi select",
};

/*
 * Workiz's custom-fields table (`table.simple-table`, uikit_wz_set_customfields,
 * pg_settings_catalogs_wz_customfields): white; a 57px head of 15px/16px 500
 * black capitalised names (20px 12px); a #f7f7f7 55px row per group — a
 * chevron that folds it, "Group: Company" in 14px bold 98px in; a 56px white
 * row per field, its name 105px in, the rows ruled #e6e6e6 (the first group
 * under #ccc). A field row opens its edit.
 */
const TH = "h-[57px] px-3 text-left align-middle text-[15px] leading-4 font-medium text-black capitalize";
const TD = "border-t border-[#e6e6e6] px-3 py-[15px] align-middle text-sm leading-4 text-wz-strong";

/**
 * Settings → Custom Fields, as Workiz's: the band, "Add New" at the right,
 * and the grouped table — Name, Job Type ("All Types" when it applies to
 * every one), Type, Required. Workiz's "Job/Lead | Client" tabs are left
 * out (our custom fields are on jobs only), and so is its drag-to-order and
 * its delete-a-whole-group (ours: Priority in the drawer, and a field's own
 * delete). The ON/OFF Status is ours, as on Job Types. The drawer is
 * Workiz's "Add New Field".
 */
export function CustomFieldsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const fieldsQuery = useCustomFields();
  const fields = fieldsQuery.data;
  // The Job Type column names the types: they join the gate, so the column
  // never shows ids that turn into names a beat later.
  const jobTypesQuery = useJobTypes();
  const jobTypes = jobTypesQuery.data;
  // One skeleton until the user, the fields and the types are in: "Add New"
  // and the rows come in the same frame, and nobody is refused for the beat
  // their permissions are still on the way.
  const ready = usePageReady(!permsLoading && settled(fieldsQuery) && settled(jobTypesQuery));
  const del = useDeleteCustomField();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomFieldDefinition | undefined>();
  const [deleting, setDeleting] = useState<CustomFieldDefinition | undefined>();
  const [folded, setFolded] = useState<ReadonlySet<string>>(new Set());

  const canCreate = can("custom_fields", "create");
  const canEdit = can("custom_fields", "edit");
  const canDelete = can("custom_fields", "delete");

  const groups = useMemo(() => groupFields(fields ?? []), [fields]);
  const typeName = useMemo(() => new Map((jobTypes ?? []).map((t) => [t.id, t.name])), [jobTypes]);

  if (!permsLoading && !can("custom_fields", "view")) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <h2 className="text-lg font-medium">No access</h2>
        <p className="text-sm text-muted-foreground">
          You don&apos;t have permission to view custom fields.
        </p>
      </div>
    );
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const openEdit = (field: CustomFieldDefinition) => {
    if (!canEdit) return;
    setEditing(field);
    setFormOpen(true);
  };
  const toggleGroup = (group: string) =>
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  const jobTypesOf = (field: CustomFieldDefinition) =>
    field.jobTypeIds.length === 0 ? "All Types" : field.jobTypeIds.map((id) => typeName.get(id) ?? id).join(", ");

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <WzSettingsHeader
        icon={<ClipboardList />}
        title="Custom Fields"
        description="Need more information on your jobs? Add your own custom fields."
      />
      {!ready ? (
        <div className="px-5 pt-5">
          <Skeleton className="h-[480px] w-full rounded-none" />
        </div>
      ) : (
        <>
          <WzSettingsBar
            className="justify-end"
            action={
              canCreate ? (
                <WzButton size="regular" icon={<Plus strokeWidth={1.75} />} onClick={openNew}>
                  Add New
                </WzButton>
              ) : null
            }
          />
          <table aria-label="Custom fields" className="w-full table-fixed border-collapse bg-white">
            <colgroup>
              <col className="w-[50px]" />
              <col />
              <col className="w-[45%]" />
              <col className="w-[151px]" />
              <col className="w-[137px]" />
              <col className="w-[120px]" />
              {canDelete ? <col className="w-[60px]" /> : null}
            </colgroup>
            <thead>
              <tr>
                <th className={TH}>
                  <span className="sr-only">Group</span>
                </th>
                <th className={TH}>name</th>
                <th className={TH}>Job Type</th>
                <th className={TH}>type</th>
                <th className={TH}>required</th>
                <th className={TH}>status</th>
                {canDelete ? (
                  <th className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            {groups.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={canDelete ? 7 : 6} className={cn(TD, "border-input py-10 text-center text-[15px] font-medium")}>
                    No Records Found
                  </td>
                </tr>
              </tbody>
            ) : (
              groups.map(({ group, fields: list }, gi) => {
                const open = !folded.has(group);
                return (
                  <tbody key={group}>
                    <tr className="bg-muted">
                      <td
                        colSpan={canDelete ? 7 : 6}
                        className={cn(
                          "h-[55px] border-t px-2.5 py-[15px] align-middle text-sm leading-4 text-wz-strong",
                          gi === 0 ? "border-input" : "border-[#e6e6e6]",
                        )}
                      >
                        <button
                          type="button"
                          aria-expanded={open}
                          onClick={() => toggleGroup(group)}
                          className="ml-[43px] flex items-center gap-[27px] outline-none focus-visible:underline"
                        >
                          <ChevronDown
                            aria-hidden
                            className={cn("size-[18px] text-wz-strong transition-transform", !open && "-rotate-90")}
                            strokeWidth={1.5}
                          />
                          <b className="font-bold capitalize">Group: {group}</b>
                        </button>
                      </td>
                    </tr>
                    {open
                      ? list.map((field) => (
                          <tr
                            key={field.id}
                            onClick={() => openEdit(field)}
                            className={cn("h-14 bg-white", canEdit && "cursor-pointer hover:bg-black/[0.03]")}
                          >
                            <td className={TD} />
                            <td className={cn(TD, "truncate")}>
                              {canEdit ? (
                                <button
                                  type="button"
                                  aria-label={`Edit ${field.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openEdit(field);
                                  }}
                                  className="ml-[43px] max-w-full truncate text-left outline-none focus-visible:underline"
                                >
                                  {field.name}
                                </button>
                              ) : (
                                <span className="ml-[43px]">{field.name}</span>
                              )}
                            </td>
                            <td className={cn(TD, "truncate")}>{jobTypesOf(field)}</td>
                            <td className={cn(TD, "capitalize")}>{TYPE_LABELS[field.type]}</td>
                            <td className={TD}>{field.required ? "Yes" : "No"}</td>
                            <td className={TD}>
                              <CustomFieldStatusSwitch field={field} disabled={!canEdit} />
                            </td>
                            {canDelete ? (
                              <td className={cn(TD, "text-right")}>
                                <button
                                  type="button"
                                  aria-label={`Delete ${field.name}`}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setDeleting(field);
                                  }}
                                  className="inline-grid size-6 place-items-center rounded-[4px] text-wz-text outline-none hover:text-wz-strong focus-visible:ring-2 focus-visible:ring-wz-focus"
                                >
                                  <Trash2 className="size-[17px]" strokeWidth={1.5} />
                                </button>
                              </td>
                            ) : null}
                          </tr>
                        ))
                      : null}
                  </tbody>
                );
              })
            )}
          </table>
        </>
      )}

      {formOpen ? (
        <CustomFieldFormDialog
          key={editing?.id ?? "new"}
          customField={editing}
          open={formOpen}
          onOpenChange={setFormOpen}
        />
      ) : null}

      <AlertDialog open={Boolean(deleting)} onOpenChange={(v) => !v && setDeleting(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom field?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{deleting?.name}&rdquo; will be removed. If any deal still has a value for it,
              it&apos;s archived instead — it leaves the forms but historical deals keep their data.
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

/** A field's Status switch: off archives it (it leaves the job forms; old jobs keep their answers). */
function CustomFieldStatusSwitch({ field, disabled }: { field: CustomFieldDefinition; disabled: boolean }) {
  const update = useUpdateCustomField(field.id);
  const pending = update.isPending ? (update.variables as { active?: boolean } | undefined)?.active : undefined;
  return (
    <WzOnOffSwitch
      aria-label={`${field.name} status`}
      checked={pending ?? field.active}
      disabled={disabled || update.isPending}
      onCheckedChange={(active) => update.mutate({ active })}
    />
  );
}
