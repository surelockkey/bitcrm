"use client";

import { useMemo, useState } from "react";
import type { JobType } from "@bitcrm/types";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzTextField } from "@/components/workiz/text-field";
import { useCreateJobType, useUpdateJobType } from "../hooks";
import { jobTypeFormSchema, toJobTypeBody } from "../schemas";

/**
 * Workiz's "Add New Job Type" / "Edit Job Type" modal
 * (pg_settings_catalogs_wz_jobtypes_add_open / _row_open): the name and the
 * order in floating-label boxes, Cancel / Save. Workiz's Days / Hours /
 * Minutes, API name and "Apply to franchises" are not ours to offer. On /
 * off is the grid's Status switch, as in Workiz; an edit keeps the state.
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
  const active = jobType?.active ?? true;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => jobTypeFormSchema.safeParse({ name, priority, active }),
    [name, priority, active],
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
      <WzTextField label="Job Type Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus overhang={false} />
      <WzTextField
        label="Priority"
        type="number"
        min={0}
        value={priority}
        onChange={(e) => setPriority(e.target.value)}
        overhang={false}
      />
    </WzFormModal>
  );
}
