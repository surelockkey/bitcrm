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
  WzOutlinedSelect,
  WzOutlinedTextField,
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
  getContactAttachmentDownloadUrl,
  requestAttachmentUpload,
  requestContactAttachmentUpload,
  uploadAttachmentBytes,
} from "@/features/deals/attachments-api";
import { useAttachmentUrls } from "@/features/deals/attachments-hooks";
import { useContactFileUrls } from "../contact-file-urls";
import { useFilePreviewStore } from "@/features/files/preview-store";
import { useCustomFields } from "../hooks";
import { applicableFields, customFieldControl, workizGroupColumns, workizOrderedGroups } from "../lib";

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
 *
 * A card is pinned to its Workiz column (`col-start-1` / `col-start-2`,
 * `workizGroupColumns`): the New Job grid flows row by row, so with a group
 * missing the rest would slide a column over (app_audit #7). Rows stay
 * aligned as in Workiz's capture because the grid still lays them out.
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
  // Each group's Workiz column, worked out over every group of the job type
  // (the sides depend on the whole set, not on the one card being drawn).
  const rightColumn = useMemo(() => {
    const all = workizOrderedGroups(applicableFields(data, jobTypeId));
    return new Set(workizGroupColumns(all)[1].map((g) => g.group));
  }, [data, jobTypeId]);

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
          <WzCard
            key={group}
            title={group}
            className={cn(rightColumn.has(group) ? "col-start-2" : "col-start-1", className)}
            data-cf-group={group}
          >
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
 * 10px apart starting 10px under the rule. The client page's Custom fields
 * tab draws its groups the same way (pg_contact_wz_269669_tab_custom-fields).
 */
export function WzCustomFieldSection({
  title,
  className,
  children,
}: {
  title: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <GroupSection title={title} className={className}>
      {children}
    </GroupSection>
  );
}

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
  /** A client's field (the client card): files upload to the client's own files. */
  contactId?: string;
  pendingFiles?: File[];
  onPendingFiles?: (files: File[]) => void;
  missing: boolean;
  shape: "rounded" | "square";
  /**
   * "form" (default): the job forms' boxes. "outlined": Workiz's newer
   * notched boxes, as on the client page's Custom fields tab — 40px text,
   * 42px select, 13px labels (pg_contact_wz_269669_tab_custom-fields).
   */
  look?: "form" | "outlined";
}

/**
 * One custom field drawn with its Workiz kit control, on its own — the client
 * card's Custom fields tab lays its groups out itself. `contactId` makes a
 * file field upload to that client's files; `dealId` to that job's.
 */
export function WzCustomFieldControl({
  missing = false,
  shape = "rounded",
  ...props
}: Omit<ControlProps, "missing" | "shape"> & { missing?: boolean; shape?: "rounded" | "square" }) {
  return <FieldControl {...props} missing={missing} shape={shape} />;
}

/** A text / number / drop-down field in the outlined look; anything else falls back to the form control. */
function OutlinedControl({ field, value, onChange, disabled, missing }: ControlProps) {
  const error = missing ? REQUIRED : undefined;
  const text = typeof value === "string" ? value : "";
  switch (customFieldControl(field.type)) {
    case "select":
      return (
        <WzOutlinedSelect
          label={field.name}
          options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
          value={text}
          disabled={disabled}
          error={error}
          onChange={(v) => onChange(v || undefined)}
        />
      );
    case "number":
      return (
        <WzOutlinedTextField
          label={field.name}
          type="number"
          inputMode="decimal"
          value={value === undefined || value === null ? "" : String(value)}
          disabled={disabled}
          error={error}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
        />
      );
    default:
      return (
        <WzOutlinedTextField
          label={field.name}
          value={text}
          disabled={disabled}
          error={error}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** The kit control `customFieldControl` names for this field's type. */
function FieldControl(props: ControlProps) {
  const { field, value, onChange, disabled, missing, shape } = props;
  if (props.look === "outlined" && ["text", "number", "select"].includes(customFieldControl(field.type))) {
    return (
      <div data-missing={missing || undefined}>
        <OutlinedControl {...props} />
      </div>
    );
  }
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
function FileControl({ field, value, onChange, disabled, dealId, contactId, pendingFiles, onPendingFiles, missing }: ControlProps) {
  // A stored answer may be one legacy id or a list.
  const ids = useMemo(
    () => (Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : []),
    [value],
  );
  const held = pendingFiles ?? [];
  const deferred = !dealId && Boolean(onPendingFiles);
  // A client's field: no job to hang the file on — it is the client's own file.
  const client = !dealId && !deferred && Boolean(contactId);
  const [uploading, setUploading] = useState(false);
  const preview = useFilePreviewStore((s) => s.preview);
  const dealUrls = useAttachmentUrls(dealId ?? "", deferred || !dealId ? [] : ids);
  const clientUrls = useContactFileUrls(contactId ?? "", client ? ids : []);
  const urls = client ? clientUrls : dealUrls;
  const heldUrls = useObjectUrls(held);

  if (!dealId && !onPendingFiles && !client) {
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
    if (!dealId && !client) return;
    setUploading(true);
    try {
      const added: string[] = [];
      for (const file of picked) {
        const body = {
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
        };
        const ticket = client
          ? await requestContactAttachmentUpload(contactId!, body)
          : await requestAttachmentUpload(dealId!, body);
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
    if (deferred || (!dealId && !client)) return;
    const i = ids.indexOf(id);
    preview({
      name: `File ${i + 1}`,
      load: async () =>
        (client ? await getContactAttachmentDownloadUrl(contactId!, id) : await getAttachmentDownloadUrl(dealId!, id))
          .downloadUrl,
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
