"use client";

import { useMemo, useState } from "react";
import { JOB_TAG_COLORS, type ClientTag, type JobTagColor } from "@bitcrm/types";
import { WzColorDots } from "@/components/workiz/color-dots";
import { WzFormModal } from "@/components/workiz/form-modal";
import { WzOutlinedTextField } from "@/components/workiz/outlined-text-field";
import { useCreateClientTag, useUpdateClientTag } from "../hooks";
import { clientTagFormSchema, toClientTagBody } from "../schemas";
import { TAG_SWATCH_CLASSES } from "../lib";

const COLORS = JOB_TAG_COLORS.map((c) => ({ value: c, label: c, className: TAG_SWATCH_CLASSES[c] }));

/**
 * Add / edit a client tag in Workiz's Sub Status modal
 * (pg_settings_catalogs_wz_substatus_add_open): Workiz has no tags settings
 * page, so the tag form borrows its nearest, a name, a priority and the
 * "Choose color" dots, Cancel / Save. The same modal serves Settings and the
 * client card's tag picker (prefilled with the search, `onCreated`). On / off is
 * the grid's Status switch; an edit keeps the state.
 */
export function ClientTagFormDialog({
  clientTag,
  initialName,
  open,
  onOpenChange,
  onCreated,
}: {
  clientTag?: ClientTag;
  /** Prefills the name when creating, e.g. from a picker's search query. */
  initialName?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Called with the new tag after a successful create (not on edit). */
  onCreated?: (tag: ClientTag) => void;
}) {
  const editing = Boolean(clientTag);
  const create = useCreateClientTag();
  const update = useUpdateClientTag(clientTag?.id ?? "");
  const pending = create.isPending || update.isPending;

  const [name, setName] = useState(clientTag?.name ?? initialName ?? "");
  const [color, setColor] = useState<JobTagColor>(clientTag?.color ?? "slate");
  const [priority, setPriority] = useState(String(clientTag?.priority ?? 0));
  const active = clientTag?.active ?? true;
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(
    () => clientTagFormSchema.safeParse({ name, color, priority, active }),
    [name, color, priority, active],
  );

  const submit = () => {
    setError(null);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check the form");
      return;
    }
    const body = toClientTagBody(parsed.data);
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
      title={editing ? "Edit Client Tag" : "Add New Client Tag"}
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
