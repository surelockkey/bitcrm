"use client";

import { useMemo, useState } from "react";
import type { JobType } from "@bitcrm/types";
import { WzDurationFields } from "@/components/workiz/duration-fields";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzTextField } from "@/components/workiz/text-field";
import { useCreateJobType, useUpdateJobType } from "../hooks";
import { splitDuration } from "../lib";
import { jobTypeFormSchema, toJobTypeBody } from "../schemas";

/**
 * Workiz's "Add New Job Type" / "Edit Job Type" modal
 * (pg_settings_catalogs_wz_jobtypes_add_open / _row_open): the name and the
 * order in floating-label boxes, then Workiz's Duration — Days / Hours /
 * Minutes with "How long does this type of job usually take?" — and
 * Cancel / Save. Workiz's API name and "Apply to franchises" are not ours to
 * offer. On / off is the grid's Status switch, as in Workiz; an edit keeps
 * the state.
 */
export function JobTypeFormDialog({
  jobType,
  open,
  onOpenChange,
}: {
  jobType?: JobType;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(jobType);
  const create = useCreateJobType();
  const update = useUpdateJobType(jobType?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(jobType?.name ?? "");
  const [priority, setPriority] = useState(String(jobType?.priority ?? 0));
  const [durationMinutes, setDurationMinutes] = useState(jobType?.durationMinutes ?? 0);
  const active = jobType?.active ?? true;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => jobTypeFormSchema.safeParse({ name, priority, active, ...splitDuration(durationMinutes) }),
    [name, priority, active, durationMinutes],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toJobTypeBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit Job Type" : "Add New Job Type"}
      onSave={submit}
      saving={pending}
      saveDisabled={!parsed.success}
      error={error}
    >
      <WzTextField label="Job Type Name" value={name} onChange={(e) => setName(e.target.value)} overhang={false} />
      <WzTextField
        label="Priority"
        type="number"
        min={0}
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
        overhang={false}
      />
      <WzDurationFields value={durationMinutes} onChange={setDurationMinutes} disabled={pending} />
    </WzFormModal>
  );
}
