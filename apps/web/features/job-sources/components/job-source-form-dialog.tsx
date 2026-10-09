"use client";

import { useMemo, useState } from "react";
import type { JobSource } from "@bitcrm/types";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzTextField } from "@/components/workiz/text-field";
import { useCreateJobSource, useUpdateJobSource } from "../hooks";
import { jobSourceFormSchema, toJobSourceBody } from "../schemas";

/**
 * Workiz's "Add new Ad Group" modal (pg_settings_catalogs_wz_adgroups_add_open)
 * for a job source: the name and the order in floating-label boxes, Cancel /
 * Save. Workiz's Description box is not ours to offer (a source has none);
 * on / off is the grid's Status switch, and an edit keeps the state.
 */
export function JobSourceFormDialog({
  jobSource,
  open,
  onOpenChange,
}: {
  jobSource?: JobSource;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(jobSource);
  const create = useCreateJobSource();
  const update = useUpdateJobSource(jobSource?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(jobSource?.name ?? "");
  const [priority, setPriority] = useState(String(jobSource?.priority ?? 0));
  const active = jobSource?.active ?? true;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => jobSourceFormSchema.safeParse({ name, priority, active }),
    [name, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toJobSourceBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit Job Source" : "Add new Job Source"}
      onSave={submit}
      saving={pending}
      saveDisabled={!parsed.success}
      error={error}
    >
      <WzTextField label="Job source name" value={name} onChange={(e) => setName(e.target.value)} overhang={false} />
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
