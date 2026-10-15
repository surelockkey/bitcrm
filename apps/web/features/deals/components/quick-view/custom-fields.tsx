"use client";

import { useState } from "react";
import type { CustomFieldValue, Deal } from "@bitcrm/types";
import { WzCustomFields } from "@/features/custom-fields/components/wz-custom-fields";
import { useCustomFields } from "@/features/custom-fields/hooks";
import { applicableFields } from "@/features/custom-fields/lib";
import { useUpdateDeal } from "../../hooks";
import { QvButtons } from "./parts";

/**
 * Workiz's Custom fields tab (quickview_wz_tab_custom_fields): every field of
 * the job type, grouped under its 16px/600 heading, editable in the pane;
 * Cancel / Save appear once something changed.
 */
export function CustomFieldsTab({ deal, canEdit }: { deal: Deal; canEdit: boolean }) {
  const update = useUpdateDeal(deal.id);
  const { data: defs } = useCustomFields();
  const [draft, setDraft] = useState<Record<string, CustomFieldValue> | null>(null);
  const value = draft ?? deal.customFields ?? {};
  const any = applicableFields(defs, deal.jobTypeId).length > 0;

  if (!any) return <p className="px-6 py-8 text-center text-[13px] leading-[19px] text-[#566d76]">No custom fields for this job type.</p>;

  return (
    <div className="px-6 pt-4 pb-6">
      <WzCustomFields layout="section" jobTypeId={deal.jobTypeId} value={value} onChange={setDraft} disabled={!canEdit} dealId={deal.id} />
      {draft ? (
        <QvButtons
          className="mt-4"
          onCancel={() => setDraft(null)}
          onSave={() => update.mutate({ customFields: draft }, { onSuccess: () => setDraft(null) })}
          saving={update.isPending}
        />
      ) : null}
    </div>
  );
}
