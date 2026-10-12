"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Contact, CustomFieldValue } from "@bitcrm/types";
import { WzButton } from "@/components/workiz/button";
import { useClientCustomFields } from "@/features/custom-fields/hooks";
import { clientFieldColumns, customFieldAnswersPatch } from "@/features/custom-fields/lib";
import { WzCustomFieldControl, WzCustomFieldSection } from "@/features/custom-fields/components/wz-custom-fields";
import { useSaveClientCustomFields } from "../hooks";

/**
 * Workiz's client page "Custom fields" tab (pg_contact_wz_269669_tab_custom-fields):
 * the client fields (Settings → Custom Fields → Client) as a form — the
 * groups as the job page draws its custom-field sections (18px/22px 600
 * heading over a 1px rule, 43px; fields 40px tall, 24px apart) in two 537px
 * columns, 58px apart, the groups taking them in turn (Work Order | Platinum
 * Info, then Extra Info) — "Need to track more fields? Create a custom field"
 * under them, and a yellow 150×40 Save centred at the foot. Save sends only
 * the answers that changed; it waits until something has.
 *
 * Read-only for whoever cannot edit the client; the link only for whoever may
 * add a field.
 */
export function ClientCustomFieldsTab({
  contact,
  canEdit,
  canCreateField,
}: {
  contact: Contact;
  canEdit: boolean;
  canCreateField: boolean;
}) {
  const { data: defs } = useClientCustomFields();
  const save = useSaveClientCustomFields(contact.id);
  // A copy of what is stored, keys no form shows included, so they never
  // look cleared.
  const [draft, setDraft] = useState<Record<string, CustomFieldValue | undefined>>(() => ({
    ...(contact.customFields ?? {}),
  }));
  const [left, right] = useMemo(() => clientFieldColumns(defs), [defs]);
  const patch = customFieldAnswersPatch(contact.customFields, draft);
  const dirty = Object.keys(patch).length > 0;
  const none = left.length === 0;

  const write = (id: string, next: CustomFieldValue | undefined) =>
    setDraft((d) => {
      const copy = { ...d };
      if (next === undefined || next === "") delete copy[id];
      else copy[id] = next;
      return copy;
    });

  const column = (groups: typeof left) => (
    <div data-testid="client-cf-column" className="flex min-w-0 flex-col gap-[30px]">
      {groups.map(({ group, fields }) => (
        <WzCustomFieldSection key={group} title={group} className="gap-6 [&>*:first-child]:mb-[-14px]">
          {fields.map((field) => (
            <WzCustomFieldControl
              key={field.id}
              field={field}
              value={draft[field.id]}
              onChange={(next) => write(field.id, next)}
              disabled={!canEdit}
              contactId={contact.id}
            />
          ))}
        </WzCustomFieldSection>
      ))}
    </div>
  );

  return (
    <div className="flex min-w-0 flex-col pt-2.5 pr-[26px] pl-2.5">
      {none ? (
        <p className="py-6 text-sm leading-[21px] text-wz-caption">No client custom fields yet.</p>
      ) : (
        <div className="grid grid-cols-1 gap-x-[58px] gap-y-[30px] md:grid-cols-2">
          {column(left)}
          {column(right)}
        </div>
      )}

      {canCreateField ? (
        <p className="mt-10 text-sm leading-4 text-wz-strong">
          Need to track more fields?{" "}
          {/* rgb(61,166,225): Workiz's underlined link here, a one-off (pg_contact_wz_269669_tab_custom-fields). */}
          <Link href="/settings/custom-fields?tab=client" className="text-[#3da6e1] underline underline-offset-2">
            Create a custom field
          </Link>
        </p>
      ) : null}

      {canEdit && !none ? (
        <div className="sticky bottom-0 mt-6 flex justify-center bg-white/90 py-[15px]">
          <WzButton
            className="min-w-[150px]"
            disabled={!dirty}
            loading={save.isPending}
            onClick={() => save.mutate(patch)}
          >
            Save
          </WzButton>
        </div>
      ) : null}
    </div>
  );
}
