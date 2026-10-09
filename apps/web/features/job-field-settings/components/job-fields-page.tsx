"use client";

import { useId } from "react";
import { ListChecks } from "lucide-react";
import { JOB_REQUIRABLE_FIELDS, type CustomFieldDefinition } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { WzOnOffSwitch } from "@/components/workiz/on-off-switch";
import { WzSettingsHeader } from "@/components/workiz/settings-page";
import { usePermissions } from "@/features/auth/use-permissions";
import { settled, usePageReady } from "@/lib/use-page-ready";
import { useCustomFields, useUpdateCustomField } from "@/features/custom-fields/hooks";
import { groupFields } from "@/features/custom-fields/lib";
import { useJobFieldSettings, useUpdateJobFieldSettings } from "../hooks";

/**
 * Settings → Job Fields, as Workiz's Field Validation
 * (pg_settings_catalogs_wz_managefields): the band set 20px into the page,
 * then a row per field — "First Name Required?" in 12px/16px bold #666,
 * right-aligned in a 150px column 20px in, the ON/OFF switch 60px after it,
 * rows 58px apart under a 1px #e0e0e0 rule. Workiz's "Restore Default
 * Settings" is not ours (no stored defaults to go back to). The custom
 * fields' own Required flags are ours, under their group in the same rows.
 * Read-only without `settings.edit`.
 */
export function JobFieldsPage() {
  const { can, isLoading: permsLoading } = usePermissions();
  const canEdit = can("settings", "edit");
  const settingsQuery = useJobFieldSettings();
  const settings = settingsQuery.data;
  const update = useUpdateJobFieldSettings();
  const customFieldsQuery = useCustomFields();
  const customFieldDefs = customFieldsQuery.data;
  // The two lists used to load apart, and whichever came second moved the
  // other: one skeleton holds both until both lists — and the right to edit
  // them — are in.
  const ready = usePageReady(!permsLoading && settled(settingsQuery) && settled(customFieldsQuery));

  const toggleBuiltin = (id: string) => {
    if (!settings) return;
    update.mutate({
      requiredFields: { ...settings.requiredFields, [id]: !settings.requiredFields[id] },
    });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col px-5 pt-5 pb-10">
      <WzSettingsHeader
        icon={<ListChecks />}
        title="Job Fields"
        description="Field validation applies for job creation only — the New Job form and the API."
      />

      {!ready ? (
        <Skeleton className="mt-5 h-96 w-full rounded-none" />
      ) : (
        <>
          {settings ? (
            <div>
              {JOB_REQUIRABLE_FIELDS.map((f, i) => (
                <FieldRow
                  key={f.id}
                  label={`${f.label} Required?`}
                  checked={Boolean(settings.requiredFields[f.id])}
                  disabled={!canEdit || update.isPending}
                  onToggle={() => toggleBuiltin(f.id)}
                  first={i === 0}
                />
              ))}
            </div>
          ) : null}

          {groupFields((customFieldDefs ?? []).filter((f) => f.active)).map(({ group, fields }) => (
            <section key={group} aria-label={`Custom fields: ${group}`} className="mt-10">
              {/* Workiz's block heading (the settings home's), naming the custom-field group. */}
              <h2 className="mr-[7px] ml-[3px] border-b border-wz-frame pb-[9.9px] text-lg leading-[30px] font-medium text-foreground">
                Custom fields: {group}
              </h2>
              {fields.map((f, i) => (
                <CustomFieldRow key={f.id} field={f} canEdit={canEdit} first={i === 0} />
              ))}
            </section>
          ))}
        </>
      )}
    </div>
  );
}

/** One Field Validation row: the bold right-aligned question, the ON/OFF switch. */
function FieldRow({
  label,
  checked,
  disabled,
  onToggle,
  first,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
  first: boolean;
}) {
  const labelId = useId();
  return (
    <div className={first ? "flex min-h-[58px] items-start pt-5" : "flex min-h-[58px] items-start border-t border-[#e0e0e0] pt-5"}>
      {/* #666: Workiz's form label grey (wz-text). */}
      <span id={labelId} className="ml-5 w-[150px] shrink-0 text-right text-xs leading-4 font-bold text-wz-text">
        {label}
      </span>
      <WzOnOffSwitch
        aria-labelledby={labelId}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onToggle}
        className="ml-[60px]"
      />
    </div>
  );
}

function CustomFieldRow({ field, canEdit, first }: { field: CustomFieldDefinition; canEdit: boolean; first: boolean }) {
  const update = useUpdateCustomField(field.id);

  const toggle = () => {
    update.mutate({
      name: field.name,
      type: field.type,
      group: field.group,
      options: field.options ?? [],
      jobTypeIds: field.jobTypeIds,
      required: !field.required,
      requiredToClose: field.requiredToClose,
      searchable: field.searchable,
      priority: field.priority,
      active: field.active,
    });
  };

  return (
    <FieldRow
      label={`${field.name} Required?`}
      checked={field.required}
      disabled={!canEdit || update.isPending}
      onToggle={toggle}
      first={first}
    />
  );
}
