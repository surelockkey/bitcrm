"use client";

import { useMemo, useState } from "react";
import { Check, Loader2, Plus, X } from "lucide-react";
import type { CustomFieldDefinition, CustomFieldType } from "@bitcrm/types";
import { CUSTOM_FIELD_TYPES, isOptionCustomFieldType } from "@bitcrm/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useJobTypes } from "@/features/job-types/hooks";
import { activeJobTypes } from "@/features/job-types/lib";
import { useCreateCustomField, useUpdateCustomField } from "../hooks";
import { customFieldFormSchema, toCustomFieldBody } from "../schemas";

/** Friendly labels for the fixed set of input kinds. */
const TYPE_LABELS: Record<CustomFieldType, string> = {
  text: "Text",
  large_text: "Large text",
  number: "Number",
  checkbox: "Checkbox",
  dropdown: "Dropdown",
  date: "Date",
  file: "File",
  multi_select: "Multi-select",
};

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
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
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
          className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
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
              className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
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
        priority: customField?.priority ?? 0,
        active: customField?.active ?? true,
      }),
    [name, type, group, options, jobTypeIds, required, requiredToClose, searchable, customField],
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[95vw] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? `Edit ${customField!.name}` : "New custom field"}
          </DialogTitle>
          <DialogDescription>
            A user-defined field on deals. Group related fields and scope them to job types.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Field type</Label>
              <Select value={type} onValueChange={(v) => setType(v as CustomFieldType)}>
                <SelectTrigger className="h-9 w-full">
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {CUSTOM_FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Group</Label>
              <Input
                className="h-9"
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                placeholder="General"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Field Name</Label>
            <Input
              className="h-9"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Lock Brand"
            />
          </div>

          {optionType ? (
            <div className="space-y-1.5">
              <Label>Options</Label>
              <OptionsEditor options={options} onChange={setOptions} />
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label>Job Types</Label>
            <JobTypesPicker value={jobTypeIds} onChange={setJobTypeIds} />
            <p className="text-xs text-muted-foreground">
              Leave empty to apply to all job types.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <Label>Required?</Label>
            <Switch checked={required} onCheckedChange={setRequired} />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <Label>Required To Close?</Label>
            <Switch checked={requiredToClose} onCheckedChange={setRequiredToClose} />
          </div>
          <div className="flex items-center justify-between rounded-md border px-3 py-2.5">
            <Label>Searchable?</Label>
            <Switch checked={searchable} onCheckedChange={setSearchable} />
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="brand"
            className="gap-1.5"
            disabled={pending || !parsed.success}
            onClick={submit}
          >
            {pending ? <Loader2 className="size-4 animate-spin" /> : null}
            {editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
