"use client";

import { useMemo, useState } from "react";
import { JOB_TAG_COLORS, type CallTag, type JobTagColor } from "@bitcrm/types";
import { WzColorDots } from "@/components/workiz/color-dots";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzModalTextField } from "@/components/workiz/modal-text-field";
import { useCreateCallTag, useUpdateCallTag } from "../hooks";
import { callTagFormSchema, toCallTagBody } from "../schemas";
import { TAG_SWATCH_CLASSES } from "../lib";

const COLORS = JOB_TAG_COLORS.map((c) => ({ value: c, label: c, className: TAG_SWATCH_CLASSES[c] }));

/**
 * Create or edit one call tag in Workiz's Sub Status modal
 * (pg_settings_catalogs_wz_substatus_add_open): the name, the picker
 * priority and the "Choose color" dots, Cancel / Save. The same modal serves
 * Settings and the inline "Create new" in the picker on a call (prefilled
 * with the search, `onCreated`). Archiving is the grid's Status switch; an
 * edit keeps the state.
 */
export function CallTagFormDialog({
  callTag,
  initialName,
  open,
  onOpenChange,
  onCreated,
}: {
  callTag?: CallTag;
  /** Prefills the name when creating, e.g. from the picker's search query. */
  initialName?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new tag after a successful create (not on edit). */
  onCreated?: (tag: CallTag) => void;
}) {
  const editing = Boolean(callTag);
  const create = useCreateCallTag();
  const update = useUpdateCallTag(callTag?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(callTag?.name ?? initialName ?? "");
  const [color, setColor] = useState<JobTagColor>(callTag?.color ?? "slate");
  const [priority, setPriority] = useState(String(callTag?.priority ?? 0));
  const active = callTag?.active ?? true;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => callTagFormSchema.safeParse({ name, color, priority, active }),
    [name, color, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toCallTagBody(parsed.data);
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
      title={editing ? "Edit Call Tag" : "Add New Call Tag"}
      onSave={submit}
      saving={pending}
      saveDisabled={!parsed.success}
      error={error}
      className="w-[524px] sm:max-w-[524px]"
    >
      <WzModalTextField label="Tag name" value={name} onChange={setName} />
      <WzModalTextField label="Priority" type="number" min={0} value={priority} onChange={setPriority} />
      <WzColorDots label="Choose color" options={COLORS} value={color} onChange={(c) => setColor(c as JobTagColor)} />
    </WzFormModal>
  );
}
