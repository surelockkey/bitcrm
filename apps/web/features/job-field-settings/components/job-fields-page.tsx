"use client";

import { Asterisk } from "lucide-react";
import { JOB_REQUIRABLE_FIELDS, type CustomFieldDefinition } from "@bitcrm/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePermissions } from "@/features/auth/use-permissions";
import { useCustomFields, useUpdateCustomField } from "@/features/custom-fields/hooks";
import { groupFields } from "@/features/custom-fields/lib";
import { useJobFieldSettings, useUpdateJobFieldSettings } from "../hooks";

/**
 * Settings → Job Fields: one screen where an admin decides which job fields
 * are required — the built-in New Job fields and every custom field alike.
 * Read-only without `settings.edit`.
 */
export function JobFieldsPage() {
  const { can } = usePermissions();
  const canEdit = can("settings", "edit");
  const { data: settings, isLoading } = useJobFieldSettings();
  const update = useUpdateJobFieldSettings();
  const { data: customFieldDefs } = useCustomFields();

  const toggleBuiltin = (id: string) => {
    if (!settings) return;
    update.mutate({
      requiredFields: { ...settings.requiredFields, [id]: !settings.requiredFields[id] },
    });
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 px-6 py-6">
      <div>
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight">
          <Asterisk className="size-5 text-brand" /> Job Fields
        </h1>
        <p className="text-sm text-muted-foreground">
          Which fields must be filled when creating a job. Applies to the New Job form and the API.
        </p>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Default fields
        </h2>
        {isLoading || !settings ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="divide-y">
            {JOB_REQUIRABLE_FIELDS.map((f) => (
              <div key={f.id} className="flex items-center justify-between py-2.5">
                <span className="text-sm">{f.label}</span>
                <Switch
                  aria-label={f.label}
                  checked={Boolean(settings.requiredFields[f.id])}
                  disabled={!canEdit || update.isPending}
                  onCheckedChange={() => toggleBuiltin(f.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Custom fields
        </h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Toggling writes the field&apos;s own Required flag — the same one Settings → Custom Fields edits.
        </p>
        {groupFields((customFieldDefs ?? []).filter((f) => f.active)).map(({ group, fields }) => (
          <div key={group} className="mb-3 last:mb-0">
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">{group}</h3>
            <div className="divide-y">
              {fields.map((f) => (
                <CustomFieldRow key={f.id} field={f} canEdit={canEdit} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CustomFieldRow({ field, canEdit }: { field: CustomFieldDefinition; canEdit: boolean }) {
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
    <div className="flex items-center justify-between py-2.5">
      <span className="text-sm">{field.name}</span>
      <Switch
        aria-label={field.name}
        checked={field.required}
        disabled={!canEdit || update.isPending}
        onCheckedChange={toggle}
      />
    </div>
  );
}
