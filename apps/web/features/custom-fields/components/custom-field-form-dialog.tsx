"use client";

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { CustomFieldDefinition, CustomFieldType } from "@bitcrm/types";
import { CUSTOM_FIELD_TYPES, isOptionCustomFieldType } from "@bitcrm/types";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzModalTextField } from "@/components/workiz/modal-text-field";
import { WzMiniToggle } from "@/components/workiz/switch-tabs";
import { useJobTypes } from "@/features/job-types/hooks";
import { activeJobTypes } from "@/features/job-types/lib";
import { useCreateCustomField, useUpdateCustomField } from "../hooks";
import { customFieldFormSchema, toCustomFieldBody } from "../schemas";

/** The input kinds in Workiz's words ("Drop Down", "Files"). */
const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  large_text: "Large Text",
  number: "Number",
  checkbox: "Checkbox",
  dropdown: "Drop Down",
  date: "Date",
  file: "Files",
  multi_select: "Multi Select",
};
const TYPE_OPTIONS = CUSTOM_FIELD_TYPES.map((t) => ({ value: t, label: TYPE_LABELS[t] }));

/**
 * Job-type multiselect for a custom field's scope. Selected types show as
 * removable chips; empty selection reads "All Job Types" (the field applies
 * everywhere). Mirrors the job-tag combobox's command-on-a-button pattern.
 */
function JobTypesPicker({
  value,
  onChange,
}: {
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const { data } = useJobTypes();
  const active = activeJobTypes(data);
  const map = useMemo(() => new Map((data ?? []).map((t) => [t.id, t.name])), [data]);
  const [open, setOpen] = useState(false);

  const toggle = (id: string) =>
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.length === 0 ? (
        <span className="text-sm text-muted-foreground">All Job Types</span>
      ) : (
        value.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-xs font-medium"
          >
            {map.get(id) ?? id}
            <button
              type="button"
              onClick={() => toggle(id)}
              className="opacity-70 hover:opacity-100"
              aria-label={`Remove ${map.get(id) ?? "job type"}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))
      )}

      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1 rounded-chip border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
        >
          <Plus className="size-3" /> Add job type
        </button>

        {open ? (
          <>
            <button
              type="button"
              aria-label="Close"
              className="fixed inset-0 z-10 cursor-default"
              onClick={() => setOpen(false)}
            />
            <div className="absolute left-0 top-full z-20 mt-1 w-56 overflow-hidden rounded-lg border bg-popover shadow-md">
              <Command loop>
                <CommandInput autoFocus placeholder="Search job types…" className="h-9" />
                <CommandList className="max-h-56">
                  <CommandEmpty>No job types found.</CommandEmpty>
                  <CommandGroup>
                    {active.map((jobType) => {
                      const checked = value.includes(jobType.id);
                      return (
                        <CommandItem
                          key={jobType.id}
                          value={jobType.name}
                          onSelect={() => toggle(jobType.id)}
                          className="gap-2"
                        >
                          {jobType.name}
                          {checked ? <Check className="ml-auto size-4 text-brand" /> : null}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Add/remove string chips for dropdown / multi_select options. */
function OptionsEditor({
  options,
  onChange,
}: {
  options: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  const add = () => {
    const val = draft.trim();
    if (!val || options.includes(val)) {
      setDraft("");
      return;
    }
    onChange([...options, val]);
    setDraft("");
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {options.length === 0 ? (
          <span className="text-xs text-muted-foreground">No options yet.</span>
        ) : (
          options.map((opt) => (
            <span
              key={opt}
              className="inline-flex items-center gap-1 rounded-chip border px-2 py-0.5 text-xs font-medium"
            >
              {opt}
              <button
                type="button"
                onClick={() => onChange(options.filter((o) => o !== opt))}
                className="opacity-70 hover:opacity-100"
                aria-label={`Remove ${opt}`}
              >
                <X className="size-3" />
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex gap-2">
        <Input
          className="h-9"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Add an option"
        />
        <Button type="button" variant="outline" className="h-9 gap-1" onClick={add}>
          <Plus className="size-4" /> Add
        </Button>
      </div>
    </div>
  );
}

/**
 * Workiz's "Add New Field" drawer (pg_settings_catalogs_wz_customfields_add_open):
 * 350px on the right under its grey band head — Field Name, Field type,
 * Group in the outlined boxes, the job types it applies to ("All Job Types"
 * when none), then "Required?", "Required To Close?" and "searchable?" on
 * Workiz's small dark toggles; Cancel / Save sharing the foot. The options
 * of a Drop Down / Multi Select and the Priority (Workiz drags the rows
 * instead) are ours, in the same boxes. On / off is the table's Status
 * switch; an edit keeps the state.
 */
export function CustomFieldFormDialog({
  customField,
  open,
  onOpenChange,
}: {
  customField?: CustomFieldDefinition;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(customField);
  const create = useCreateCustomField();
  const update = useUpdateCustomField(customField?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(customField?.name ?? "");
  const [type, setType] = useState<CustomFieldType>(customField?.type ?? "text");
  const [group, setGroup] = useState(customField?.group ?? "");
  const [options, setOptions] = useState<string[]>(customField?.options ?? []);
  const [jobTypeIds, setJobTypeIds] = useState<string[]>(customField?.jobTypeIds ?? []);
  const [required, setRequired] = useState(customField?.required ?? false);
  const [requiredToClose, setRequiredToClose] = useState(customField?.requiredToClose ?? false);
  const [searchable, setSearchable] = useState(customField?.searchable ?? false);
  const [priority, setPriority] = useState(String(customField?.priority ?? 0));
  const [error, setError] = useState<string | null>(null);

  const optionType = isOptionCustomFieldType(type);

  const parsed = useMemo(
    () =>
      customFieldFormSchema.safeParse({
        name,
        type,
        group,
        options,
        jobTypeIds,
        required,
        requiredToClose,
        searchable,
        priority,
        active: customField?.active ?? true,
      }),
    [name, type, group, options, jobTypeIds, required, requiredToClose, searchable, priority, customField],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toCustomFieldBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  const toggles: { label: string; checked: boolean; set: (v: boolean) => void }[] = [
    { label: "Required?", checked: required, set: setRequired },
    { label: "Required To Close?", checked: requiredToClose, set: setRequiredToClose },
    { label: "searchable?", checked: searchable, set: setSearchable },
  ];

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit Field" : "Add New Field"}
      onSave={submit}
      saving={pending}
      saveDisabled={!parsed.success}
      error={error}
      variant="drawer"
    >
      <WzModalTextField label="Field Name" value={name} onChange={setName} />
      <WzOutlinedSelect
        label="Field type"
        options={TYPE_OPTIONS}
        value={type}
        onChange={(v) => setType((v || "text") as CustomFieldType)}
      />
      <WzModalTextField label="Group" value={group} onChange={setGroup} />

      {optionType ? (
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-[21px] text-wz-strong">Options</p>
          <OptionsEditor options={options} onChange={setOptions} />
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <JobTypesPicker value={jobTypeIds} onChange={setJobTypeIds} />
        <p className="text-xs leading-[18px] text-wz-caption">Leave empty to apply to all job types.</p>
      </div>

      <WzModalTextField label="Priority" type="number" min={0} value={priority} onChange={setPriority} />

      <div className="flex flex-col gap-[29px]">
        {toggles.map((t) => (
          <div key={t.label} className="flex items-center justify-between">
            <span className="text-sm leading-[21px] text-wz-strong">{t.label}</span>
            <WzMiniToggle label={t.label} checked={t.checked} onCheckedChange={t.set} />
          </div>
        ))}
      </div>
    </WzFormModal>
  );
}
