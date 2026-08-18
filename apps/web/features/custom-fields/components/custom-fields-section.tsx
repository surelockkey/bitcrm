"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, FileText, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import type { CustomFieldDefinition, CustomFieldValue } from "@bitcrm/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
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
import {
  getAttachmentDownloadUrl,
  requestAttachmentUpload,
  uploadAttachmentBytes,
} from "@/features/deals/attachments-api";
import { useAttachmentUrl } from "@/features/deals/attachments-hooks";
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
   * here (keyed by field id, up to 5 each) and reported via onPendingFiles;
   * the caller uploads them right after the job is created.
   */
  pendingFiles?: Record<string, File[]>;
  onPendingFiles?: (fieldId: string, files: File[]) => void;
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
  onPendingFiles,
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
                pendingFiles={pendingFiles?.[field.id]}
                onPendingFiles={onPendingFiles ? (f) => onPendingFiles(field.id, f) : undefined}
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
  pendingFiles,
  onPendingFiles,
}: {
  field: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  onChange: (next: CustomFieldValue | undefined) => void;
  disabled?: boolean;
  dealId?: string;
  pendingFiles?: File[];
  onPendingFiles?: (files: File[]) => void;
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
        pendingFiles={pendingFiles}
        onPendingFiles={onPendingFiles}
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
  pendingFiles,
  onPendingFiles,
}: {
  field: CustomFieldDefinition;
  labelId: string;
  value: CustomFieldValue | undefined;
  onChange: (next: CustomFieldValue | undefined) => void;
  disabled?: boolean;
  dealId?: string;
  pendingFiles?: File[];
  onPendingFiles?: (files: File[]) => void;
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
          value={value}
          disabled={disabled}
          dealId={dealId}
          onChange={onChange}
          pendingFiles={pendingFiles}
          onPendingFiles={onPendingFiles}
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
 * File field, Workiz-style: a square "+" tile that takes up to 5 files, each
 * shown as a chip. On a saved job every pick uploads through the presigned
 * flow and the value stores the attachment ids; on a new job (no dealId)
 * files are held in memory via onPendingFiles and upload right after create.
 */
const MAX_FILES = 5;

function FileControl({
  value,
  onChange,
  disabled,
  dealId,
  pendingFiles,
  onPendingFiles,
}: {
  value: CustomFieldValue | undefined;
  onChange: (next: CustomFieldValue | undefined) => void;
  disabled?: boolean;
  dealId?: string;
  pendingFiles?: File[];
  onPendingFiles?: (files: File[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Stored value may be a single legacy id or a list.
  const ids = Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : [];
  const held = pendingFiles ?? [];
  const deferred = !dealId && Boolean(onPendingFiles);
  const count = deferred ? held.length : ids.length;
  const full = count >= MAX_FILES;

  if (!dealId && !onPendingFiles) {
    return (
      <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
        Save the job first to attach a file.
      </p>
    );
  }

  /** Open a stored attachment — popup-safe: the tab opens inside the click. */
  const view = (attachmentId: string) => {
    if (!dealId) return;
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    void (async () => {
      try {
        const { downloadUrl } = await getAttachmentDownloadUrl(dealId, attachmentId);
        if (tab) tab.location.replace(downloadUrl);
        else window.open(downloadUrl, "_blank", "noopener,noreferrer");
      } catch (e) {
        tab?.close();
        toast.error(getApiErrorMessage(e));
      }
    })();
  };

  const uploadNow = async (files: File[]) => {
    if (!dealId) return;
    setUploading(true);
    try {
      const newIds: string[] = [];
      for (const file of files) {
        const ticket = await requestAttachmentUpload(dealId, {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
        await uploadAttachmentBytes(ticket.uploadUrl, file, ticket.headers);
        newIds.push(ticket.id);
      }
      const next = [...ids, ...newIds].slice(0, MAX_FILES);
      onChange(next.length ? next : undefined);
      toast.success(newIds.length > 1 ? "Files uploaded" : "File uploaded");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const picked = (list: FileList | null) => {
    const files = [...(list ?? [])].slice(0, MAX_FILES - count);
    if (!files.length) return;
    if (deferred) onPendingFiles!([...held, ...files].slice(0, MAX_FILES));
    else void uploadNow(files);
  };

  return (
    <div className="space-y-1.5">
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          picked(e.target.files);
          e.target.value = "";
        }}
      />

      <div className="flex flex-wrap items-start gap-2.5">
        {deferred
          ? held.map((file, i) => (
              <PendingFileTile
                key={`${file.name}-${i}`}
                file={file}
                disabled={disabled}
                onRemove={() => onPendingFiles!(held.filter((_, j) => j !== i))}
              />
            ))
          : ids.map((id, i) => (
              <SavedFileTile
                key={id}
                index={i}
                attachmentId={id}
                dealId={dealId!}
                disabled={disabled}
                onView={() => view(id)}
                onRemove={() => {
                  const next = ids.filter((x) => x !== id);
                  onChange(next.length ? next : undefined);
                }}
              />
            ))}

        {!full ? (
          <button
            type="button"
            aria-label="Attach file"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            className="grid size-14 flex-none place-items-center rounded-lg border-2 border-dashed text-muted-foreground transition-colors hover:border-brand/60 hover:bg-brand/5 hover:text-brand disabled:cursor-not-allowed disabled:opacity-50"
          >
            {uploading ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-5" />}
          </button>
        ) : null}
      </div>

      <p className="text-[11px] text-muted-foreground">
        You can choose up to {MAX_FILES} files{deferred ? " — they upload when the job is created" : ""}.
      </p>
    </div>
  );
}

/** A file held in memory for a job that isn't created yet: thumb + name + ×. */
function PendingFileTile({
  file,
  disabled,
  onRemove,
}: {
  file: File;
  disabled?: boolean;
  onRemove: () => void;
}) {
  // jsdom has no createObjectURL — degrade to the icon there and in tests.
  const url = useMemo(
    () =>
      file.type.startsWith("image/") && typeof URL.createObjectURL === "function"
        ? URL.createObjectURL(file)
        : null,
    [file],
  );
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return (
    <div className="relative w-14 flex-none">
      <div className="grid size-14 place-items-center overflow-hidden rounded-lg border bg-muted/30">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element -- local object URL
          <img src={url} alt={file.name} className="size-full object-cover" />
        ) : (
          <FileText className="size-5 text-muted-foreground" />
        )}
      </div>
      {!disabled ? (
        <button
          type="button"
          aria-label={`Remove ${file.name}`}
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-background shadow-sm hover:text-destructive"
        >
          <X className="size-3" />
        </button>
      ) : null}
      <p className="mt-1 truncate text-center text-[10px] text-muted-foreground" title={file.name}>
        {file.name}
      </p>
    </div>
  );
}

/** An uploaded attachment: presigned thumbnail, click to open, × to detach. */
function SavedFileTile({
  attachmentId,
  dealId,
  index,
  disabled,
  onView,
  onRemove,
}: {
  attachmentId: string;
  dealId: string;
  index: number;
  disabled?: boolean;
  onView: () => void;
  onRemove: () => void;
}) {
  const { data } = useAttachmentUrl(dealId, attachmentId);
  const [broken, setBroken] = useState(false);

  return (
    <div className="relative w-14 flex-none">
      <button
        type="button"
        aria-label={`View file ${index + 1}`}
        onClick={onView}
        className="grid size-14 w-full place-items-center overflow-hidden rounded-lg border bg-muted/30 transition-opacity hover:opacity-80"
      >
        {data?.downloadUrl && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element -- presigned S3 URL
          <img
            src={data.downloadUrl}
            alt={`File ${index + 1}`}
            onError={() => setBroken(true)}
            className="size-full object-cover"
          />
        ) : (
          <FileText className="size-5 text-muted-foreground" />
        )}
      </button>
      {!disabled ? (
        <button
          type="button"
          aria-label={`Remove file ${index + 1}`}
          onClick={onRemove}
          className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full border bg-background shadow-sm hover:text-destructive"
        >
          <X className="size-3" />
        </button>
      ) : null}
      <p className="mt-1 truncate text-center text-[10px] text-muted-foreground">File {index + 1}</p>
    </div>
  );
}
