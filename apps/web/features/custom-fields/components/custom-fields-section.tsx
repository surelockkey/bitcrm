"use client";

import { useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import type { CustomFieldDefinition, CustomFieldValue } from "@bitcrm/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
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
import { getApiErrorMessage } from "@/lib/api/errors";
import { cn } from "@/lib/utils";
import { requestAttachmentUpload, uploadAttachmentBytes } from "@/features/deals/attachments-api";
import { useCustomFields } from "../hooks";
import { applicableFields, groupFields } from "../lib";

interface CustomFieldsSectionProps {
  jobTypeId: string;
  value: Record<string, CustomFieldValue>;
  onChange: (next: Record<string, CustomFieldValue>) => void;
  disabled?: boolean;
  /** Required to attach files — presigned uploads are scoped to a saved deal. */
  dealId?: string;
  /**
   * Render just this one group, without its inner heading — for pages that
   * give every group its own card (the Workiz-style New Job form).
   */
  onlyGroup?: string;
  /**
   * Deferred uploads for a job that doesn't exist yet: picked files are held
   * here (keyed by field id) and reported via onPendingFile; the caller
   * uploads them right after the job is created.
   */
  pendingFiles?: Record<string, File>;
  onPendingFile?: (fieldId: string, file: File | undefined) => void;
}

/**
 * Renders a job's applicable custom fields, grouped by their heading, one input
 * per field type. The value map is keyed by definition id; every edit is written
 * back through `onChange` with a fresh object — the map is never mutated in place.
 */
export function CustomFieldsSection({
  jobTypeId,
  value,
  onChange,
  disabled,
  dealId,
  onlyGroup,
  pendingFiles,
  onPendingFile,
}: CustomFieldsSectionProps) {
  const { data } = useCustomFields();

  const groups = useMemo(() => {
    const all = groupFields(applicableFields(data, jobTypeId));
    return onlyGroup ? all.filter((g) => g.group === onlyGroup) : all;
  }, [data, jobTypeId, onlyGroup]);

  const write = (id: string, next: CustomFieldValue | undefined) => {
    const copy = { ...value };
    if (next === undefined || next === "") delete copy[id];
    else copy[id] = next;
    onChange(copy);
  };

  if (groups.length === 0) return null;

  return (
    <div className="space-y-6">
      {groups.map(({ group, fields }) => (
        <div key={group} className="space-y-3">
          {onlyGroup ? null : (
            <h3 className="text-sm font-semibold tracking-tight text-muted-foreground">
              {group}
            </h3>
          )}
          <div className="space-y-4">
            {fields.map((field) => (
              <FieldControl
                key={field.id}
                field={field}
                value={value[field.id]}
                onChange={(v) => write(field.id, v)}
                disabled={disabled}
                dealId={dealId}
                pendingFile={pendingFiles?.[field.id]}
                onPendingFile={onPendingFile ? (f) => onPendingFile(field.id, f) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/** One labelled input for a single definition, dispatched by its type. */
function FieldControl({
  field,
  value,
  onChange,
  disabled,
  dealId,
  pendingFile,
  onPendingFile,
}: {
  field: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  onChange: (next: CustomFieldValue | undefined) => void;
  disabled?: boolean;
  dealId?: string;
  pendingFile?: File;
  onPendingFile?: (file: File | undefined) => void;
}) {
  const labelId = `cf-${field.id}`;

  const label = (
    <Label htmlFor={labelId} className="gap-1">
      {field.name}
      {field.required ? (
        <span className="text-destructive" aria-label="required">
          *
        </span>
      ) : null}
      {field.requiredToClose ? (
        <span
          className="rounded bg-muted px-1 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase"
          aria-label="required to close"
        >
          To close
        </span>
      ) : null}
    </Label>
  );

  // Checkbox reads better inline with its label; others stack.
  if (field.type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={labelId}
          aria-label={field.name}
          checked={Boolean(value)}
          disabled={disabled}
          onCheckedChange={(c) => onChange(c === true)}
        />
        {label}
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {label}
      <FieldInput
        field={field}
        labelId={labelId}
        value={value}
        onChange={onChange}
        disabled={disabled}
        dealId={dealId}
        pendingFile={pendingFile}
        onPendingFile={onPendingFile}
      />
    </div>
  );
}

/** The type-specific control, minus the shared label wrapper. */
function FieldInput({
  field,
  labelId,
  value,
  onChange,
  disabled,
  dealId,
  pendingFile,
  onPendingFile,
}: {
  field: CustomFieldDefinition;
  labelId: string;
  value: CustomFieldValue | undefined;
  onChange: (next: CustomFieldValue | undefined) => void;
  disabled?: boolean;
  dealId?: string;
  pendingFile?: File;
  onPendingFile?: (file: File | undefined) => void;
}) {
  switch (field.type) {
    case "large_text":
      return (
        <Textarea
          id={labelId}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "number":
      return (
        <Input
          id={labelId}
          type="number"
          value={value === undefined || value === null ? "" : String(value)}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );

    case "date":
      return (
        <Input
          id={labelId}
          type="date"
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    case "dropdown":
      return (
        <Select
          value={typeof value === "string" ? value : undefined}
          disabled={disabled}
          onValueChange={(v) => onChange(v)}
        >
          <SelectTrigger id={labelId} className="w-full">
            <SelectValue placeholder="Select" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "multi_select":
      return (
        <OptionsCombobox
          label={field.name}
          options={field.options ?? []}
          value={Array.isArray(value) ? value : []}
          disabled={disabled}
          onChange={(next) => onChange(next.length ? next : undefined)}
        />
      );

    case "file":
      return (
        <FileControl
          value={typeof value === "string" ? value : undefined}
          disabled={disabled}
          dealId={dealId}
          onChange={onChange}
          pendingFile={pendingFile}
          onPendingFile={onPendingFile}
        />
      );

    case "text":
    default:
      return (
        <Input
          id={labelId}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/**
 * A multi-select over a definition's own string options. Selected values show
 * as removable chips; "Add" opens a searchable dropdown. Modelled on the
 * job-tag combobox's command-on-a-button pattern.
 */
function OptionsCombobox({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  const toggle = (opt: string) =>
    onChange(value.includes(opt) ? value.filter((v) => v !== opt) : [...value, opt]);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((opt) => (
        <span
          key={opt}
          className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium"
        >
          {opt}
          {!disabled ? (
            <button
              type="button"
              onClick={() => toggle(opt)}
              className="opacity-70 hover:opacity-100"
              aria-label={`Remove ${opt}`}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}

      {disabled ? (
        value.length === 0 ? <span className="text-sm text-muted-foreground">—</span> : null
      ) : (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground"
          >
            <Plus className="size-3" /> Add {label}
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
                  <CommandInput autoFocus placeholder="Search…" className="h-9" />
                  <CommandList className="max-h-56">
                    <CommandEmpty>No options found.</CommandEmpty>
                    <CommandGroup>
                      {options.map((opt) => {
                        const checked = value.includes(opt);
                        return (
                          <CommandItem
                            key={opt}
                            value={opt}
                            onSelect={() => toggle(opt)}
                            className="gap-2"
                          >
                            {opt}
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
      )}
    </div>
  );
}

/**
 * File field: uploads through the deal's presigned-upload flow and stores the
 * resulting attachment id as the value. Uploads need a saved deal, so on a new
 * job (no `dealId`) it shows a "save the job first" affordance instead.
 */
function FileControl({
  value,
  onChange,
  disabled,
  dealId,
  pendingFile,
  onPendingFile,
}: {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  disabled?: boolean;
  dealId?: string;
  pendingFile?: File;
  onPendingFile?: (file: File | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // No saved job yet, but the caller collects files for a post-create upload:
  // hold the pick in memory and show it as attached.
  if (!dealId && onPendingFile) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onPendingFile(f);
            e.target.value = "";
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={disabled}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-3.5" />
          {pendingFile ? "Replace file" : "Attach file"}
        </Button>
        {pendingFile ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            {pendingFile.name}
            <button
              type="button"
              aria-label="Remove file"
              onClick={() => onPendingFile(undefined)}
              className="rounded p-0.5 hover:bg-muted hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Uploads when the job is created.</span>
        )}
      </div>
    );
  }

  if (!dealId) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Save the job first to attach a file.
      </p>
    );
  }

  const pick = async (file: File) => {
    setUploading(true);
    try {
      const ticket = await requestAttachmentUpload(dealId, {
        fileName: file.name,
        contentType: file.type,
        size: file.size,
      });
      await uploadAttachmentBytes(ticket.uploadUrl, file, ticket.headers);
      onChange(ticket.id);
      toast.success("File uploaded");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
      >
        {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
        {value ? "Replace file" : "Upload"}
      </Button>
      {value ? <span className={cn("text-xs text-muted-foreground")}>File attached</span> : null}
    </div>
  );
}
