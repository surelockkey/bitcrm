"use client";

/**
 * The job's custom fields drawn with the Workiz kit, for the New Job page
 * (`layout="card"`: one card per group — Extra Info, Other Contact,
 * Dispatchers, Tech, Platinum, new_01_empty_scroll1..3) and the job page's
 * Details tab (`layout="section"`: the same groups under a ruled heading,
 * job_b_01_details_scroll1..3). Same data and rules as CustomFieldsSection
 * (applicable fields for the job type, Workiz group order, answers keyed by
 * definition id, files held until a new job exists or uploaded straight to a
 * saved one), which stays as it is for its other callers.
 */

import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import type { CustomFieldDefinition, CustomFieldValue } from "@bitcrm/types";
import {
  WzCard,
  WzCheckbox,
  WzDateField,
  WzFieldError,
  WzMultiSelect,
  WzSectionHeader,
  WzSelect,
  WzTextField,
  WzTextarea,
  WzUploadField,
  type WzUploadedFile,
} from "@/components/workiz";
import { cn } from "@/lib/utils";
import { getApiErrorMessage } from "@/lib/api/errors";
import {
  getAttachmentDownloadUrl,
  requestAttachmentUpload,
  uploadAttachmentBytes,
} from "@/features/deals/attachments-api";
import { useAttachmentUrls } from "@/features/deals/attachments-hooks";
import { useFilePreviewStore } from "@/features/files/preview-store";
import { useCustomFields } from "../hooks";
import { applicableFields, customFieldControl, workizOrderedGroups } from "../lib";

/** Workiz allows five files per file field. */
const MAX_FILES = 5;
const REQUIRED = "Required field";

export interface WzCustomFieldsProps {
  /** "card": New Job cards; "section": the job page's ruled sections. */
  layout: "card" | "section";
  jobTypeId: string;
  value: Record<string, CustomFieldValue>;
  onChange: (next: Record<string, CustomFieldValue>) => void;
  disabled?: boolean;
  /** A saved job: files upload to it straight away. */
  dealId?: string;
  /** A job not created yet: picked files are held here (≤5 per field) and uploaded after create. */
  pendingFiles?: Record<string, File[]>;
  onPendingFiles?: (fieldId: string, files: File[]) => void;
  /** Fields a blocked submit left empty — each says "Required field". */
  missingIds?: string[];
  /** Draw just this group. */
  onlyGroup?: string;
  /** Classes for every card / section (grid placement, widths). */
  className?: string;
}

/**
 * One card or section per group, Workiz-ordered, returned side by side (a
 * fragment) so the page's own grid places them. Nothing when no field applies.
 */
export function WzCustomFields({
  layout,
  jobTypeId,
  value,
  onChange,
  disabled,
  dealId,
  pendingFiles,
  onPendingFiles,
  missingIds,
  onlyGroup,
  className,
}: WzCustomFieldsProps) {
  const { data } = useCustomFields();
  const groups = useMemo(() => {
    const all = workizOrderedGroups(applicableFields(data, jobTypeId));
    return onlyGroup ? all.filter((g) => g.group === onlyGroup) : all;
  }, [data, jobTypeId, onlyGroup]);

  const write = (id: string, next: CustomFieldValue | undefined) => {
    const copy = { ...value };
    if (next === undefined || next === "") delete copy[id];
    else copy[id] = next;
    onChange(copy);
  };

  if (!groups.length) return null;

  return (
    <>
      {groups.map(({ group, fields }) => {
        const body = fields.map((field) => (
          <FieldControl
            key={field.id}
            field={field}
            value={value[field.id]}
            onChange={(next) => write(field.id, next)}
            disabled={disabled}
            dealId={dealId}
            pendingFiles={pendingFiles?.[field.id]}
            onPendingFiles={onPendingFiles ? (files) => onPendingFiles(field.id, files) : undefined}
            missing={missingIds?.includes(field.id) ?? false}
            // Rounded on both pages: the job page's custom-field selects keep
            // react-select's 4px corners (job_b_01_details_scroll1), unlike its
            // square Job selects.
            shape="rounded"
          />
        ));
        return layout === "card" ? (
          <WzCard key={group} title={group} className={className} data-cf-group={group}>
            {body}
          </WzCard>
        ) : (
          <GroupSection key={group} title={group} className={className}>
            {body}
          </GroupSection>
        );
      })}
    </>
  );
}

/**
 * A custom-field group on the job page (`styles__jobCard` with an h5 header:
 * 18px semibold #404040, padded 10px, ruled 1px #cad3d6 — 43px), its fields
 * 10px apart starting 10px under the rule.
 */
function GroupSection({ title, className, children }: { title: string; className?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-cf-group={title} className={cn("flex flex-col gap-2.5", className)}>
      <WzSectionHeader id={id} className="mb-0">
        {title}
      </WzSectionHeader>
      {children}
    </section>
  );
}

/* ---------------------------------------------------------------- controls */

interface ControlProps {
  field: CustomFieldDefinition;
  value: CustomFieldValue | undefined;
  onChange: (next: CustomFieldValue | undefined) => void;
  disabled?: boolean;
  dealId?: string;
  pendingFiles?: File[];
  onPendingFiles?: (files: File[]) => void;
  missing: boolean;
  shape: "rounded" | "square";
}

/** The kit control `customFieldControl` names for this field's type. */
function FieldControl(props: ControlProps) {
  const { field, value, onChange, disabled, missing, shape } = props;
  const error = missing ? REQUIRED : undefined;
  const text = typeof value === "string" ? value : "";
  const wrap = (node: React.ReactNode) => <div data-missing={missing || undefined}>{node}</div>;

  switch (customFieldControl(field.type)) {
    case "textarea":
      return wrap(
        <WzTextarea
          placeholder={field.name}
          value={text}
          disabled={disabled}
          error={error}
          onChange={(e) => onChange(e.target.value)}
        />,
      );
    case "number":
      return wrap(
        <WzTextField
          label={field.name}
          type="number"
          inputMode="decimal"
          value={value === undefined || value === null ? "" : String(value)}
          disabled={disabled}
          error={error}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />,
      );
    case "select":
      return wrap(
        <WzSelect
          label={field.name}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          value={text}
          valueLabel={text || undefined}
          disabled={disabled}
          error={error}
          shape={shape}
          onChange={(v) => onChange(v || undefined)}
        />,
      );
    case "multiselect":
      return wrap(
        <WzMultiSelect
          label={field.name}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          value={Array.isArray(value) ? value : []}
          disabled={disabled}
          error={error}
          shape={shape}
          onChange={(next) => onChange(next.length ? next : undefined)}
        />,
      );
    case "checkbox":
      return wrap(
        <>
          <WzCheckbox
            label={field.name}
            checked={Boolean(value)}
            disabled={disabled}
            onCheckedChange={(c) => onChange(c)}
          />
          {error ? <WzFieldError>{error}</WzFieldError> : null}
        </>,
      );
    case "date":
      return wrap(
        <WzDateField
          label={field.name}
          value={text}
          disabled={disabled}
          error={error}
          onChange={(iso) => onChange(iso)}
        />,
      );
    case "upload":
      return wrap(<FileControl {...props} />);
    case "text":
    default:
      return wrap(
        <WzTextField
          label={field.name}
          value={text}
          disabled={disabled}
          error={error}
          onChange={(e) => onChange(e.target.value)}
        />,
      );
  }
}

/**
 * A file field: Workiz's "+" tile and thumbnails, 16px above and below
 * (`editableImageRowWrapper`). On a saved job each pick uploads through the
 * presigned flow and the answer keeps the attachment ids; on a new one the
 * files are held via `onPendingFiles` until the job exists.
 */
function FileControl({ field, value, onChange, disabled, dealId, pendingFiles, onPendingFiles, missing }: ControlProps) {
  // A stored answer may be one legacy id or a list.
  const ids = useMemo(
    () => (Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : []),
    [value],
  );
  const held = pendingFiles ?? [];
  const deferred = !dealId && Boolean(onPendingFiles);
  const [uploading, setUploading] = useState(false);
  const preview = useFilePreviewStore((s) => s.preview);
  const urls = useAttachmentUrls(dealId ?? "", deferred || !dealId ? [] : ids);
  const heldUrls = useObjectUrls(held);

  if (!dealId && !onPendingFiles) {
    return (
      <div className="my-4">
        <span className="text-[14px] leading-4 font-medium text-wz-strong">{field.name}</span>
        <p className="mt-2 text-[11px] leading-4 text-wz-caption">Save the job first to attach a file.</p>
      </div>
    );
  }

  const files: WzUploadedFile[] = deferred
    ? held.map((f, i) => ({ id: String(i), name: f.name, url: heldUrls[i] ?? "" }))
    : ids.map((id, i) => ({ id, name: `File ${i + 1}`, url: urls[i]?.data?.downloadUrl ?? "" }));

  const add = async (picked: File[]) => {
    if (deferred) {
      onPendingFiles!([...held, ...picked].slice(0, MAX_FILES));
      return;
    }
    if (!dealId) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of picked) {
        const ticket = await requestAttachmentUpload(dealId, {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        });
        await uploadAttachmentBytes(ticket.uploadUrl, file, ticket.headers);
        added.push(ticket.id);
      }
      const next = [...ids, ...added].slice(0, MAX_FILES);
      onChange(next.length ? next : undefined);
      toast.success(added.length > 1 ? "Files uploaded" : "File uploaded");
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    } finally {
      setUploading(false);
    }
  };

  const remove = (id: string) => {
    if (deferred) {
      onPendingFiles!(held.filter((_, i) => String(i) !== id));
      return;
    }
    const next = ids.filter((x) => x !== id);
    onChange(next.length ? next : undefined);
  };

  const open = (id: string) => {
    if (deferred || !dealId) return;
    const i = ids.indexOf(id);
    preview({
      name: `File ${i + 1}`,
      load: async () => (await getAttachmentDownloadUrl(dealId, id)).downloadUrl,
    });
  };

  return (
    <div className="my-4">
      <WzUploadField
        label={field.name}
        files={files}
        max={MAX_FILES}
        disabled={disabled || uploading}
        onAdd={(picked) => void add(picked)}
        onRemove={remove}
        onOpen={open}
      />
      {missing ? <WzFieldError className="ml-0">{REQUIRED}</WzFieldError> : null}
    </div>
  );
}

/** Object URLs for held image files (thumbnails), revoked when they go. */
function useObjectUrls(files: File[]): string[] {
  const urls = useMemo(
    () =>
      files.map((f) =>
        f.type.startsWith("image/") && typeof URL.createObjectURL === "function" ? URL.createObjectURL(f) : "",
      ),
    [files],
  );
  useEffect(
    () => () => {
      for (const u of urls) if (u) URL.revokeObjectURL(u);
    },
    [urls],
  );
  return urls;
}
