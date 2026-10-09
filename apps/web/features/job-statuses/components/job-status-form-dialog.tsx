"use client";

import { useMemo, useState } from "react";
import { JOB_TAG_COLORS, JobSuperStatus, type DealSubStatus, type JobTagColor } from "@bitcrm/types";
import { WzColorDots } from "@/components/workiz/color-dots";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzOutlinedSelect } from "@/components/workiz/outlined-select";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { GROUP_ORDER, groupLabel } from "@/features/deals/lib";
import { useCreateJobStatus, useUpdateJobStatus } from "../hooks";
import { jobStatusFormSchema, toJobStatusBody } from "../schemas";
import { STATUS_SWATCH_CLASSES } from "../lib";

const PARENTS = GROUP_ORDER.map((g) => ({ value: g, label: groupLabel(g) }));
const COLORS = JOB_TAG_COLORS.map((c) => ({ value: c, label: c, className: STATUS_SWATCH_CLASSES[c] }));

/**
 * Workiz's "Add Sub status" / "Edit Sub status" modal
 * (pg_settings_catalogs_wz_substatus_add_open / _row_open): what it is for,
 * "Select parent status" with its helper line, "Sub-status name", "Choose
 * color" dots, Cancel / Save (held until the form is whole). Priority is
 * ours (the order in the pickers), in the same outlined box. Workiz's "Api
 * name" is not ours to offer. On / off is the grid's Status switch.
 */
export function JobStatusFormDialog({
  status,
  defaultGroup,
  open,
  onOpenChange,
}: {
  status?: DealSubStatus;
  /** Pre-select the super-status. */
  defaultGroup?: JobSuperStatus;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const editing = Boolean(status);
  const create = useCreateJobStatus();
  const update = useUpdateJobStatus(status?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(status?.name ?? "");
  const [group, setGroup] = useState<JobSuperStatus | "">(status?.group ?? defaultGroup ?? "");
  const [color, setColor] = useState<JobTagColor>(status?.color ?? "slate");
  const [priority, setPriority] = useState(String(status?.priority ?? 0));
  const active = status?.active ?? true;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => jobStatusFormSchema.safeParse({ name, group: group || undefined, color, priority, active }),
    [name, group, color, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toJobStatusBody(parsed.data);
    const mutation = editing ? update : create;
    mutation.mutate(body, { onSuccess: () => onOpenChange(false) });
  };

  return (
    <WzFormModal
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? "Edit Sub status" : "Add Sub status"}
      description="Create a sub-status under a parent job status to show more detailed progress on the job and schedule"
      onSave={submit}
      saving={pending}
      saveDisabled={!parsed.success}
      error={error}
      className="w-[524px] sm:max-w-[524px]"
    >
      <div className="flex flex-col">
        <WzOutlinedSelect
          label="Select parent status"
          options={PARENTS}
          value={group}
          onChange={(v) => setGroup(v as JobSuperStatus)}
        />
        <small className="pl-[12.5px] text-xs leading-[18px] text-foreground">
          Choose the parent job status that this sub-status will fall under
        </small>
      </div>
      <WzOutlinedTextField label="Sub-status name" value={name} onChange={setName} />
      <WzOutlinedTextField label="Priority" type="number" min={0} value={priority} onChange={setPriority} />
      <WzColorDots label="Choose color" options={COLORS} value={color} onChange={(c) => setColor(c as JobTagColor)} />
    </WzFormModal>
  );
}
