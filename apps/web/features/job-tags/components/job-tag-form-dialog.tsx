"use client";

import { useMemo, useState } from "react";
import { JOB_TAG_COLORS, type JobTag, type JobTagColor } from "@bitcrm/types";
import { WzColorDots } from "@/components/workiz/color-dots";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { useCreateJobTag, useUpdateJobTag } from "../hooks";
import { jobTagFormSchema, toJobTagBody } from "../schemas";
import { TAG_SWATCH_CLASSES } from "../lib";

const COLORS = JOB_TAG_COLORS.map((c) => ({ value: c, label: c, className: TAG_SWATCH_CLASSES[c] }));

/**
 * Add / edit a job tag in Workiz's Sub Status modal
 * (pg_settings_catalogs_wz_substatus_add_open): Workiz has no tags settings
 * page, so the tag form borrows its nearest, a name, a priority and the
 * "Choose color" dots, Cancel / Save. The same modal serves Settings and the
 * job's "+ Create new" (prefilled with the search, `onCreated`). On / off is
 * the grid's Status switch; an edit keeps the state.
 */
export function JobTagFormDialog({
  jobTag,
  initialName,
  open,
  onOpenChange,
  onCreated,
}: {
  jobTag?: JobTag;
  /** Prefills the name when creating, e.g. from a picker's search query. */
  initialName?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new tag after a successful create (not on edit). */
  onCreated?: (tag: JobTag) => void;
}) {
  const editing = Boolean(jobTag);
  const create = useCreateJobTag();
  const update = useUpdateJobTag(jobTag?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(jobTag?.name ?? initialName ?? "");
  const [color, setColor] = useState<JobTagColor>(jobTag?.color ?? "slate");
  const [priority, setPriority] = useState(String(jobTag?.priority ?? 0));
  const active = jobTag?.active ?? true;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => jobTagFormSchema.safeParse({ name, color, priority, active }),
    [name, color, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toJobTagBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, {
      onSuccess: (saved) => {
        if (!editing) onCreated?.(saved);
        onOpenChange(false);
      },
    });
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit Job Tag" : "Add New Job Tag"}
      onSave={submit}
      saving={pending}
      saveDisabled={!parsed.success}
      error={error}
      className="w-[524px] sm:max-w-[524px]"
    >
      <WzOutlinedTextField label="Tag name" value={name} onChange={setName} />
      <WzOutlinedTextField label="Priority" type="number" min={0} value={priority} onChange={setPriority} />
      <WzColorDots label="Choose color" options={COLORS} value={color} onChange={(c) => setColor(c as JobTagColor)} />
    </WzFormModal>
  );
}
